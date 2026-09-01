/**
 * Which address a tenant's email goes out from.
 *
 * The From header is the one part of an outreach email a subcontractor reads
 * before deciding whether it is legitimate, and Gmail refuses to send as an
 * address the account has not verified. So the set of legal values comes from
 * Google, and this file pins the rules that follow from that: unverified
 * aliases are never offered, an unverified address is never stored, and the
 * platform's own mail uses the same address as its outreach.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORG = "11111111-2222-4333-8444-555555555555";

/** What Google would return for a mailbox with one verified alias. */
const SEND_AS_ROWS = [
  { sendAsEmail: "hello@webiq.co", isPrimary: true, displayName: "WebIQ" },
  {
    sendAsEmail: "hello@brostco.com",
    verificationStatus: "accepted",
    displayName: "BROST CO",
  },
  { sendAsEmail: "pending@brostco.com", verificationStatus: "pending", displayName: "" },
];

interface Harness {
  sendAsList: () => Promise<{ data: { sendAs: unknown[] } }>;
  updates: { sql: string; params: unknown[] }[];
}

async function loadGmail(harness: Harness) {
  vi.resetModules();
  process.env.GMAIL_CLIENT_ID = "test-client-id";
  process.env.GMAIL_CLIENT_SECRET = "test-client-secret";
  process.env.AUTH_SECRET =
    process.env.AUTH_SECRET ||
    "test-secret-that-is-plenty-long-for-aes-key-derivation-000000";

  vi.doMock("googleapis", () => ({
    google: {
      auth: {
        OAuth2: class {
          setCredentials() {}
          async getAccessToken() {
            return { token: "access" };
          }
        },
      },
      gmail: () => ({
        users: {
          settings: { sendAs: { list: harness.sendAsList } },
        },
      }),
    },
  }));

  vi.doMock("@/lib/db", () => ({ query: dbQuery, queryOne: dbQueryOne }));
  vi.doMock("../lib/db", () => ({ query: dbQuery, queryOne: dbQueryOne }));

  async function dbQuery(sql: string, params: unknown[]) {
    if (/^\s*update integration_tokens/i.test(sql)) {
      harness.updates.push({ sql, params });
      return [];
    }
    return [];
  }
  async function dbQueryOne(sql: string) {
    if (/select data from integration_tokens/i.test(sql)) {
      return { data: { refresh_token: "a-refresh-token" } };
    }
    return null;
  }

  const mod = await import("../lib/integrations/gmail");
  mod.__resetSendAsCache();
  return mod;
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("googleapis");
  vi.doUnmock("@/lib/db");
  vi.doUnmock("../lib/db");
});

describe("the addresses offered to the operator", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = {
      updates: [],
      sendAsList: async () => ({ data: { sendAs: SEND_AS_ROWS } }),
    };
  });

  it("offers the account itself and its verified aliases", async () => {
    const { gmail } = await loadGmail(harness);
    const list = await gmail.sendAsAddresses(ORG);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.options.map((o) => o.address)).toEqual([
      "hello@webiq.co",
      "hello@brostco.com",
    ]);
  });

  it("leaves out an alias Google has not verified yet", async () => {
    const { gmail } = await loadGmail(harness);
    const list = await gmail.sendAsAddresses(ORG);
    if (!list.ok) throw new Error("expected a list");
    expect(list.options.some((o) => o.address === "pending@brostco.com")).toBe(false);
  });

  it("explains the failure instead of pretending there are no addresses", async () => {
    harness.sendAsList = async () => {
      throw new Error("Request had insufficient authentication scopes.");
    };
    const { gmail } = await loadGmail(harness);
    const list = await gmail.sendAsAddresses(ORG);
    expect(list.ok).toBe(false);
    if (list.ok) return;
    expect(list.error).toMatch(/Reconnect Google Inbox/i);
  });
});

describe("what an operator is told when Google refuses the From address", () => {
  it("names the address and where to fix it, instead of Google's wording", async () => {
    const { describeSendFailure } = await import("../lib/integrations/gmail");
    const said = describeSendFailure(
      "Invalid From header",
      "BROST CO <hello@brostco.com>"
    );
    expect(said).toContain("hello@brostco.com");
    expect(said).toMatch(/Send mail as/i);
  });

  it("leaves an unrelated failure alone, so it is not misdiagnosed as a sender problem", async () => {
    const { describeSendFailure } = await import("../lib/integrations/gmail");
    expect(describeSendFailure("Rate Limit Exceeded", "BROST CO <hello@brostco.com>")).toBe(
      "Rate Limit Exceeded"
    );
  });
});

describe("choosing the sending address", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = {
      updates: [],
      sendAsList: async () => ({ data: { sendAs: SEND_AS_ROWS } }),
    };
  });

  it("stores an address Google has verified", async () => {
    const { gmail } = await loadGmail(harness);
    const res = await gmail.setSendAs("hello@brostco.com", ORG);
    expect(res).toMatchObject({ ok: true, sendAs: "hello@brostco.com" });
    expect(harness.updates).toHaveLength(1);
    expect(harness.updates[0].params).toEqual([ORG, "hello@brostco.com"]);
  });

  it("refuses an address the account cannot send as, and writes nothing", async () => {
    const { gmail } = await loadGmail(harness);
    const res = await gmail.setSendAs("owner@somewhere-else.com", ORG);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/not verified|has not verified/i);
    expect(harness.updates).toHaveLength(0);
  });

  it("refuses an alias that is still pending verification", async () => {
    const { gmail } = await loadGmail(harness);
    expect((await gmail.setSendAs("pending@brostco.com", ORG)).ok).toBe(false);
    expect(harness.updates).toHaveLength(0);
  });

  it("clears the choice so mail goes back to the connected account", async () => {
    const { gmail } = await loadGmail(harness);
    const res = await gmail.setSendAs("", ORG);
    expect(res).toMatchObject({ ok: true, sendAs: null });
    expect(harness.updates[0].params).toEqual([ORG, null]);
  });

  it("does not store anything while Google's list is unreadable", async () => {
    harness.sendAsList = async () => {
      throw new Error("network down");
    };
    const { gmail } = await loadGmail(harness);
    expect((await gmail.setSendAs("hello@brostco.com", ORG)).ok).toBe(false);
    expect(harness.updates).toHaveLength(0);
  });
});
