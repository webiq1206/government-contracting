import { describe, it, expect, vi, afterEach } from "vitest";
import {
  sanitizeDisplayName,
  sanitizeLocalPart,
  isValidSendingDomain,
  formatSender,
} from "@/lib/domain/sending-domain";

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
    expect(formatSender(name, "bids", "mail.acme.com")).not.toMatch(/[\r\n]/);
  });

  it("strips angle brackets and quotes that would break the address", () => {
    expect(sanitizeDisplayName('Acme <evil@x.com> "spoof"')).toBe("Acme evil@x.com spoof");
  });

  it("never emits an em dash to a recipient", () => {
    expect(sanitizeDisplayName("Acme — Builders")).toBe("Acme - Builders");
    expect(sanitizeDisplayName("Acme – Builders")).toBe("Acme - Builders");
  });

  it("reduces a local part to dot-atom characters and never returns empty", () => {
    expect(sanitizeLocalPart("Bids Team!")).toBe("bidsteam");
    expect(sanitizeLocalPart("  ")).toBe("bids");
    expect(sanitizeLocalPart("...x...")).toBe("x");
    expect(sanitizeLocalPart("a@b.com")).toBe("ab.com"); // dots are legal
  });

  it("omits the display name entirely when nothing survives sanitising", () => {
    expect(formatSender("", "bids", "mail.acme.com")).toBe("bids@mail.acme.com");
  });
});

describe("sending domain validation", () => {
  it("accepts real domains and subdomains", () => {
    expect(isValidSendingDomain("mail.acme.com")).toBe(true);
    expect(isValidSendingDomain("acme.co.uk")).toBe(true);
    expect(isValidSendingDomain("send.brostco.com")).toBe(true);
  });

  it("rejects single labels, bare suffixes, and malformed input", () => {
    expect(isValidSendingDomain("localhost")).toBe(false);
    expect(isValidSendingDomain("com")).toBe(false);
    expect(isValidSendingDomain("acme..com")).toBe(false);
    expect(isValidSendingDomain("-acme.com")).toBe(false);
    expect(isValidSendingDomain("acme.com ")).toBe(true); // trimmed
    expect(isValidSendingDomain("http://acme.com")).toBe(false);
    expect(isValidSendingDomain("acme.com/path")).toBe(false);
    expect(isValidSendingDomain("a@acme.com")).toBe(false);
    expect(isValidSendingDomain("acme.123")).toBe(false);
  });

  it("rejects a domain carrying a newline", () => {
    expect(isValidSendingDomain("acme.com\r\nBcc: x@y.com")).toBe(false);
  });
});

/**
 * The three-way branch that decides a tenant's From header. Each arm has a
 * different failure cost, so each is pinned:
 *   verified   -> their own domain
 *   no row     -> shared platform domain, their inbox still on Reply-To
 *   db failure -> platform identity, never a silent downgrade
 */
describe("resolveOutreachSender branches", () => {
  const ORG = "11111111-2222-4333-8444-555555555555";

  async function withRows(impl: () => Promise<unknown>) {
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({ query: impl, queryOne: async () => null }));
    return import("@/lib/domain/sending-domain");
  }

  afterEach(() => {
    vi.doUnmock("@/lib/db");
    vi.resetModules();
  });

  it("uses the tenant's own domain once verified", async () => {
    const m = await withRows(async () => [
      {
        domain: "mail.acme.com",
        from_local: "bids",
        from_name: "Acme Builders",
        reply_to: "jobs@acme.com",
        status: "verified",
        org_name: "Acme",
      },
    ]);
    const s = await m.resolveOutreachSender(ORG);
    expect(s).toMatchObject({
      from: "Acme Builders <bids@mail.acme.com>",
      replyTo: "jobs@acme.com",
      verified: true,
    });
  });

  it("uses the shared domain but the tenant's real inbox before verification", async () => {
    const m = await withRows(async () => [
      {
        domain: "mail.acme.com",
        from_local: "bids",
        from_name: "Acme Builders",
        reply_to: "jobs@acme.com",
        status: "pending",
        org_name: "Acme",
      },
    ]);
    const s = await m.resolveOutreachSender(ORG);
    expect(s.verified).toBe(false);
    expect(s.from).toContain("@send.brostco.com");
    // The whole point of the fallback: a reply still reaches the customer.
    expect(s.replyTo).toBe("jobs@acme.com");
  });

  it("does not downgrade a verified tenant when the database is unreachable", async () => {
    const m = await withRows(async () => {
      throw new Error("connection refused");
    });
    const s = await m.resolveOutreachSender(ORG);
    expect(s.from).toBe("BROSTCO <info@brostco.com>");
    expect(s.from).not.toContain("send.brostco.com");
    expect(s.verified).toBe(true);
  });
});
