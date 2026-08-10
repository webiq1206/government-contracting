import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { verifySvixSignature } from "../lib/webhook-verify";
import { replyCorrelationAddress, parseCorrelationToken } from "../lib/reply-capture";

describe("replyCorrelationAddress", () => {
  it("plus-addresses the outreach mailbox with the tracking id", () => {
    expect(replyCorrelationAddress("BROSTCO <info@brostco.com>", "abc-123")).toBe(
      "info+tabc-123@brostco.com"
    );
  });
  it("handles bare addresses", () => {
    expect(replyCorrelationAddress("info@brostco.com", "deadbeef")).toBe(
      "info+tdeadbeef@brostco.com"
    );
  });
  it("returns null for malformed addresses", () => {
    expect(replyCorrelationAddress("not-an-email", "x")).toBeNull();
  });
});

describe("parseCorrelationToken", () => {
  const uuid = "0b7f9a2c-9f1e-4c1d-8b3a-1234567890ab";
  it("extracts the token from a plus-addressed recipient", () => {
    expect(parseCorrelationToken([`info+t${uuid}@brostco.com`])).toBe(uuid);
  });
  it("extracts from display-name form and mixed recipients", () => {
    expect(
      parseCorrelationToken(["someone@else.com", `BROSTCO <INFO+t${uuid}@BROSTCO.COM>`])
    ).toBe(uuid);
  });
  it("returns null when no token is present", () => {
    expect(parseCorrelationToken(["info@brostco.com", "x@y.com"])).toBeNull();
  });
});

describe("verifySvixSignature", () => {
  const rawSecret = Buffer.from("test-secret-key-32-bytes-long!!!").toString("base64");
  const secret = `whsec_${rawSecret}`;
  function sign(id: string, ts: string, payload: string): string {
    const key = Buffer.from(rawSecret, "base64");
    return "v1," + createHmac("sha256", key).update(`${id}.${ts}.${payload}`).digest("base64");
  }
  const now = String(Math.floor(Date.now() / 1000));

  it("accepts a valid signature", () => {
    const payload = JSON.stringify({ type: "email.received" });
    const header = sign("msg_1", now, payload);
    expect(
      verifySvixSignature({ secret, id: "msg_1", timestamp: now, payload, signatureHeader: header })
    ).toBe(true);
  });
  it("rejects a tampered payload", () => {
    const header = sign("msg_1", now, "{}");
    expect(
      verifySvixSignature({
        secret,
        id: "msg_1",
        timestamp: now,
        payload: '{"evil":true}',
        signatureHeader: header,
      })
    ).toBe(false);
  });
  it("rejects a stale timestamp", () => {
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    const payload = "{}";
    const header = sign("msg_1", old, payload);
    expect(
      verifySvixSignature({ secret, id: "msg_1", timestamp: old, payload, signatureHeader: header })
    ).toBe(false);
  });
  it("rejects a wrong secret", () => {
    const payload = "{}";
    const header = sign("msg_1", now, payload);
    const other = `whsec_${Buffer.from("another-secret-key-32-bytes!!!!!").toString("base64")}`;
    expect(
      verifySvixSignature({ secret: other, id: "msg_1", timestamp: now, payload, signatureHeader: header })
    ).toBe(false);
  });
});
