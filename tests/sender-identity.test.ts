import { describe, it, expect, vi, afterEach } from "vitest";
import {
  sanitizeDisplayName,
  sanitizeAddress,
  formatSender,
} from "@/lib/domain/sender-identity";

/**
 * The From header is assembled from values a customer types into a settings
 * form, so these helpers are the boundary between user input and an SMTP
 * header. Anything that could open a second header line, break the quoting, or
 * put an em dash in front of a subcontractor has to be neutralised here.
 */
describe("sender identity is built from untrusted input safely", () => {
  it("strips newlines so a display name cannot inject a header", () => {
    const name = sanitizeDisplayName("Acme\r\nBcc: attacker@evil.com");
    expect(name).not.toMatch(/[\r\n]/);
    expect(formatSender(name, "bids@mail.acme.com")).not.toMatch(/[\r\n]/);
  });

  it("strips angle brackets and quotes that would break the address", () => {
    expect(sanitizeDisplayName('Acme <evil@x.com> "spoof"')).toBe("Acme evil@x.com spoof");
  });

  it("never emits an em dash to a recipient", () => {
    expect(sanitizeDisplayName("Acme — Builders")).toBe("Acme - Builders");
    expect(sanitizeDisplayName("Acme – Builders")).toBe("Acme - Builders");
  });

  it("rejects an address carrying a newline or a second recipient", () => {
    expect(sanitizeAddress("a@b.com\r\nBcc: x@y.com")).toBe("");
    expect(sanitizeAddress("a@b.com, x@y.com")).toBe("");
    expect(sanitizeAddress("not-an-address")).toBe("");
    expect(sanitizeAddress("bids@mail.acme.com")).toBe("bids@mail.acme.com");
  });

  it("omits the display name entirely when nothing survives sanitising", () => {
    expect(formatSender("", "bids@mail.acme.com")).toBe("bids@mail.acme.com");
  });
});

/**
 * Identity is read from the connected inbox. Each arm has a different failure
 * cost, so each is pinned:
 *   connected + alias -> the verified send-as address
 *   connected         -> the authorized address
 *   revoked / absent  -> not connected, so the transport refuses to send
 */
describe("resolveOutreachSender", () => {
  const ORG = "11111111-2222-4333-8444-555555555555";

  async function withRows(impl: () => Promise<unknown>) {
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({ query: impl, queryOne: async () => null }));
    return import("@/lib/domain/sender-identity");
  }

  afterEach(() => {
    vi.doUnmock("@/lib/db");
    vi.resetModules();
  });

  it("prefers a verified send-as alias over the authorized address", async () => {
    const m = await withRows(async () => [
      {
        email: "owner@acme.com",
        send_as: "bids@acme.com",
        display_name: "Acme Builders",
        status: "connected",
        org_name: "Acme",
      },
    ]);
    const s = await m.resolveOutreachSender(ORG);
    expect(s).toMatchObject({
      from: "Acme Builders <bids@acme.com>",
      replyTo: "bids@acme.com",
      connected: true,
    });
  });

  it("falls back to the org name when no display name is set", async () => {
    const m = await withRows(async () => [
      {
        email: "owner@acme.com",
        send_as: null,
        display_name: null,
        status: "connected",
        org_name: "Acme",
      },
    ]);
    expect((await m.resolveOutreachSender(ORG)).from).toBe("Acme <owner@acme.com>");
  });

  it("reports not connected once the grant is revoked", async () => {
    const m = await withRows(async () => [
      {
        email: "owner@acme.com",
        send_as: null,
        display_name: null,
        status: "revoked",
        org_name: "Acme",
      },
    ]);
    expect((await m.resolveOutreachSender(ORG)).connected).toBe(false);
  });

  it("reports not connected rather than inventing an address on a db failure", async () => {
    const m = await withRows(async () => {
      throw new Error("connection refused");
    });
    const s = await m.resolveOutreachSender(ORG);
    expect(s.connected).toBe(false);
    expect(s.from).toBe("");
  });
});
