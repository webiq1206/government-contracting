/**
 * The vendor portal is the one unauthenticated, internet-facing write surface:
 * an external subcontractor signs a W-9 or uploads an insurance certificate
 * with no account, and the signed token in the URL IS the authorization. So
 * the token must be unforgeable, non-transferable to another subcontractor,
 * expiring, and namespace-separated from the read-only document links; and the
 * upload parser must refuse anything oversized or of the wrong type.
 */
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  encodePortalToken,
  decodePortalToken,
  PORTAL_TTL_SECONDS,
} from "@/lib/domain/sub-portal-link";
import {
  parseComplianceUpload,
  MAX_UPLOAD_BYTES,
} from "@/lib/sub-compliance-store";

const SUB = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const b64url = (s: string) =>
  Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

describe("portal token authorization", () => {
  it("round-trips to the exact subcontractor it names", () => {
    const t = encodePortalToken({ s: SUB, e: Math.floor(Date.now() / 1000) + PORTAL_TTL_SECONDS });
    expect(decodePortalToken(t)?.s).toBe(SUB);
  });

  it("rejects a forged or garbage token", () => {
    expect(decodePortalToken("")).toBeNull();
    expect(decodePortalToken("not.a.token")).toBeNull();
    expect(decodePortalToken("abc")).toBeNull();
  });

  it("rejects a tampered payload (repointing the token at another sub)", () => {
    const t = encodePortalToken({ s: SUB, e: Math.floor(Date.now() / 1000) + 3600 });
    const [, sig] = t.split(".");
    // Swap the subject to OTHER but keep the original signature.
    const forgedPayload = b64url(JSON.stringify({ s: OTHER, e: Math.floor(Date.now() / 1000) + 3600 }));
    expect(decodePortalToken(`${forgedPayload}.${sig}`)).toBeNull();
  });

  it("rejects an expired token", () => {
    const t = encodePortalToken({ s: SUB, e: Math.floor(Date.now() / 1000) - 1 });
    expect(decodePortalToken(t)).toBeNull();
  });

  it("does not accept a token signed with the wrong key namespace", () => {
    // A read-only doc link (or anything) signed with the bare secret must not
    // verify as a write-authorizing portal token.
    const payload = b64url(JSON.stringify({ s: SUB, e: Math.floor(Date.now() / 1000) + 3600 }));
    const secret = process.env.AUTH_SECRET || process.env.SESSION_SECRET || "dev-insecure-secret-change-me";
    const wrongSig = createHmac("sha256", secret) // no "sub-portal:" prefix
      .update(payload).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(decodePortalToken(`${payload}.${wrongSig}`)).toBeNull();
  });
});

describe("compliance upload validation", () => {
  const fd = (over: { docType?: string; file?: File; expires?: string } = {}) => {
    const f = new FormData();
    f.set("doc_type", over.docType ?? "coi_general_liability");
    if (over.file !== undefined) f.set("file", over.file);
    if (over.expires !== undefined) f.set("expires_at", over.expires);
    return f;
  };
  const future = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
  const pdf = (bytes = 100) => new File([new Uint8Array(bytes)], "cert.pdf", { type: "application/pdf" });

  it("accepts a valid PDF certificate with a future expiry", async () => {
    const r = await parseComplianceUpload(fd({ file: pdf(), expires: future }));
    expect(r.ok).toBe(true);
  });

  it("refuses an unknown document type", async () => {
    const r = await parseComplianceUpload(fd({ docType: "totally_made_up", file: pdf(), expires: future }));
    expect(r.ok).toBe(false);
  });

  it("refuses a missing file", async () => {
    const r = await parseComplianceUpload(fd({ expires: future }));
    expect(r.ok).toBe(false);
  });

  it("refuses an oversized file", async () => {
    const big = new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], "big.pdf", { type: "application/pdf" });
    const r = await parseComplianceUpload(fd({ file: big, expires: future }));
    expect(r.ok).toBe(false);
  });

  it("refuses a disallowed file type", async () => {
    const exe = new File([new Uint8Array(100)], "payload.exe", { type: "application/x-msdownload" });
    const r = await parseComplianceUpload(fd({ file: exe, expires: future }));
    expect(r.ok).toBe(false);
  });

  it("refuses an insurance certificate with no expiry, and one already expired", async () => {
    expect((await parseComplianceUpload(fd({ file: pdf() }))).ok).toBe(false);
    const past = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    expect((await parseComplianceUpload(fd({ file: pdf(), expires: past }))).ok).toBe(false);
  });
});
