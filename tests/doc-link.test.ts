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
const OPPORTUNITY = "991f1e31-4c12-4a3c-80af-0fb8c8c67784";

describe("public document links for subcontractors", () => {
  it("round-trips a stored-file pointer", () => {
    const t = encodeDocToken({
      k: "s",
      v: "bids/abc/sow.pdf",
      n: "SOW.pdf",
      e: future,
      o: OPPORTUNITY,
    });
    expect(decodeDocToken(t)).toMatchObject({
      k: "s",
      v: "bids/abc/sow.pdf",
      n: "SOW.pdf",
      o: OPPORTUNITY,
    });
  });

  it("rejects a tampered payload", () => {
    const t = encodeDocToken({
      k: "s",
      v: "bids/abc/sow.pdf",
      n: "SOW.pdf",
      e: future,
      o: OPPORTUNITY,
    });
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
    expect(decodeDocToken(`${payload}.${sig}.extra`)).toBeNull();
    expect(decodeDocToken("garbage")).toBeNull();
  });

  it("rejects an expired token", () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const t = encodeDocToken({
      k: "s",
      v: "a/b.pdf",
      n: "b.pdf",
      e: past,
      o: OPPORTUNITY,
    });
    expect(decodeDocToken(t)).toBeNull();
  });

  it("only proxies allow-listed hosts, never an arbitrary URL", () => {
    expect(isAllowedUpstream("https://sam.gov/api/x.pdf")).toBe(true);
    expect(isAllowedUpstream("https://falextracts.s3.amazonaws.com/a.pdf")).toBe(true);
    expect(isAllowedUpstream("https://bucket.s3.us-gov-west-1.amazonaws.com/a.pdf")).toBe(true);
    expect(isAllowedUpstream("https://evil.example.com/a.pdf")).toBe(false);
    expect(isAllowedUpstream("http://sam.gov/a.pdf")).toBe(false); // no plain http
    expect(isAllowedUpstream("https://notsam.gov.evil.com/a.pdf")).toBe(false);
  });

  it("refuses a token pointing at a non-allow-listed host even if signed", () => {
    const t = encodeDocToken({
      k: "u",
      v: "https://evil.example.com/x.pdf",
      n: "x.pdf",
      e: future,
      o: OPPORTUNITY,
    });
    expect(decodeDocToken(t)).toBeNull();
  });

  it("builds an absolute link on OUR domain, never SAM or a storage provider", () => {
    const url = publicDocUrl({
      k: "u",
      v: "https://sam.gov/api/plans.pdf",
      n: "plans.pdf",
      o: OPPORTUNITY,
    });
    expect(url.startsWith("https://brostco.com/d/")).toBe(true);
    expect(url).not.toContain("sam.gov");
    expect(url).not.toContain("supabase");
  });

  it("produces a link that needs no login to open", () => {
    // The token itself is the credential: decoding succeeds with no session.
    const url = publicDocUrl({
      k: "s",
      v: "bids/x/sow.pdf",
      n: "SOW.pdf",
      o: OPPORTUNITY,
    });
    const token = url.split("/d/")[1];
    expect(decodeDocToken(token)).not.toBeNull();
  });

  it("refuses to mint a stored or upstream link without an opportunity scope", () => {
    expect(() =>
      encodeDocToken({ k: "s", v: "bids/x/sow.pdf", n: "SOW.pdf", e: future })
    ).toThrow(/scoped to an opportunity/i);
  });

  it("refuses the public default signing secret in production", () => {
    const nodeEnv = process.env.NODE_ENV;
    const authSecret = process.env.AUTH_SECRET;
    const sessionSecret = process.env.SESSION_SECRET;
    process.env.NODE_ENV = "production";
    delete process.env.AUTH_SECRET;
    delete process.env.SESSION_SECRET;
    try {
      expect(() =>
        encodeDocToken({
          k: "s",
          v: "bids/x/sow.pdf",
          n: "SOW.pdf",
          e: future,
          o: OPPORTUNITY,
        })
      ).toThrow(/AUTH_SECRET/);
    } finally {
      process.env.NODE_ENV = nodeEnv;
      if (authSecret == null) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = authSecret;
      if (sessionSecret == null) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = sessionSecret;
    }
  });
});
