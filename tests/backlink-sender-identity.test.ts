import { describe, expect, it, beforeEach, vi } from "vitest";

/**
 * Backlink outreach is outreach, and has to leave from the same address.
 *
 * This module is the application's second outbound-mail sink, and it sent
 * without naming a From: Gmail then stamps whichever account authorized the
 * connection, so an operator who had chosen a sending address would still see
 * these particular strangers receive mail from the old one. The wrong-address
 * problem does not get to survive in a corner of the product.
 */

const sends: { from?: string; replyTo?: string; to: string }[] = [];

const dbRows = {
  outreach: {
    id: "o1",
    prospect_id: "p1",
    subject: "Hello",
    body: "Body",
    approval_status: "approved",
    sent_at: null,
    contact_email: "editor@example.com",
    domain: "example.com",
  },
  followUps: [
    {
      id: "o2",
      subject: "Hello",
      body: "Body",
      gmail_thread_id: "t1",
      contact_email: "editor@example.com",
      domain: "example.com",
      tracking_id: "tr1",
    },
  ],
};

vi.mock("../lib/db", () => ({
  queryOne: async (sql: string) => (/from backlink_outreach o join/.test(sql) ? dbRows.outreach : null),
  query: async (sql: string) => {
    if (/follow_up_at is not null/.test(sql)) return dbRows.followUps;
    return [];
  },
}));

vi.mock("../lib/impersonation", () => ({ currentImpersonator: async () => null }));
vi.mock("../lib/logger", () => ({ logAgent: async () => {} }));

vi.mock("../lib/integrations/gmail", () => ({
  gmail: {
    isConnected: async () => true,
    send: async (params: { from?: string; replyTo?: string; to: string }) => {
      sends.push(params);
      return { messageId: "m1", threadId: "t1", rfc822MessageId: "<m1@mail>" };
    },
  },
}));

vi.mock("../lib/domain/sender-identity", () => ({
  resolveOutreachSender: async () => ({
    from: "BROST CO <hello@brostco.com>",
    replyTo: "hello@brostco.com",
    connected: true,
  }),
}));

const { sendApprovedOutreach, sendFollowUps } = await import("../lib/backlink-send");

beforeEach(() => {
  sends.length = 0;
});

describe("the address backlink outreach goes out from", () => {
  it("is the one the organization chose, not whichever account authorized Gmail", async () => {
    const out = await sendApprovedOutreach("o1", "org-1");
    expect(out.status).toBe("sent");
    expect(sends[0].from).toBe("BROST CO <hello@brostco.com>");
  });

  it("is the same on the follow-up, so the recipient sees one correspondent", async () => {
    await sendFollowUps("org-1");
    expect(sends[0].from).toBe("BROST CO <hello@brostco.com>");
  });

  it("carries a Reply-To, so an answer reaches the mailbox the app reads", async () => {
    await sendApprovedOutreach("o1", "org-1");
    expect(sends[0].replyTo).toBe("hello@brostco.com");
  });
});

describe("when the identity cannot be read", () => {
  it("still sends, rather than holding already-approved mail", async () => {
    vi.resetModules();
    vi.doMock("../lib/domain/sender-identity", () => ({
      resolveOutreachSender: async () => {
        throw new Error("database unavailable");
      },
    }));
    const mod = await import("../lib/backlink-send");
    const out = await mod.sendApprovedOutreach("o1", "org-1");
    expect(out.status).toBe("sent");
    // No From means Gmail uses the connected account: wrong address, working
    // mail, and the settings page shows which address that is.
    expect(sends[0].from).toBeUndefined();
  });
});
