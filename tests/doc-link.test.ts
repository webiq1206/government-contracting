import { describe, it, expect, beforeAll } from "vitest";
import {
  encodeDocToken,
  decodeDocToken,
  publicDocUrl,
  isAllowedUpstream,
} from "@/lib/domain/doc-link";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-for-doc-links";
  process.env.APP_URL = "https://brostco.com";
});

const future = Math.floor(Date.now() / 1000) + 3600;

describe("public document links for subcontractors", () => {
  it("round-trips a stored-file pointer", () => {
    const t = encodeDocToken({ k: "s", v: "bids/abc/sow.pdf", n: "SOW.pdf", e: future });
    expect(decodeDocToken(t)).toMatchObject({ k: "s", v: "bids/abc/sow.pdf", n: "SOW.pdf" });
  });

  it("rejects a tampered payload", () => {
    const t = encodeDocToken({ k: "s", v: "bids/abc/sow.pdf", n: "SOW.pdf", e: future });
    const [payload, sig] = t.split(".");
    const evil = Buffer.from(
      JSON.stringify({ k: "s", v: "../../etc/passwd", n: "x", e: future })
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(decodeDocToken(`${evil}.${sig}`)).toBeNull();
    expect(decodeDocToken(`${payload}.abc`)).toBeNull();
    expect(decodeDocToken("garbage")).toBeNull();
  });

  it("rejects an expired token", () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const t = encodeDocToken({ k: "s", v: "a/b.pdf", n: "b.pdf", e: past });
    expect(decodeDocToken(t)).toBeNull();
  });

  it("only proxies allow-listed hosts, never an arbitrary URL", () => {
    expect(isAllowedUpstream("https://sam.gov/api/x.pdf")).toBe(true);
    expect(isAllowedUpstream("https://falextracts.s3.amazonaws.com/a.pdf")).toBe(true);
    expect(isAllowedUpstream("https://evil.example.com/a.pdf")).toBe(false);
    expect(isAllowedUpstream("http://sam.gov/a.pdf")).toBe(false); // no plain http
    expect(isAllowedUpstream("https://notsam.gov.evil.com/a.pdf")).toBe(false);
  });

  it("refuses a token pointing at a non-allow-listed host even if signed", () => {
    const t = encodeDocToken({ k: "u", v: "https://evil.example.com/x.pdf", n: "x.pdf", e: future });
    expect(decodeDocToken(t)).toBeNull();
  });

  it("builds an absolute link on OUR domain, never SAM or a storage provider", () => {
    const url = publicDocUrl({ k: "u", v: "https://sam.gov/api/plans.pdf", n: "plans.pdf" });
    expect(url.startsWith("https://brostco.com/d/")).toBe(true);
    expect(url).not.toContain("sam.gov");
    expect(url).not.toContain("supabase");
  });

  it("produces a link that needs no login to open", () => {
    // The token itself is the credential: decoding succeeds with no session.
    const url = publicDocUrl({ k: "s", v: "bids/x/sow.pdf", n: "SOW.pdf" });
    const token = url.split("/d/")[1];
    expect(decodeDocToken(token)).not.toBeNull();
  });
});
