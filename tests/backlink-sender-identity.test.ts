import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

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
const sendErrors: string[] = [];
let gmailConnectionError: Error | null = null;
let gmailSendError: Error | null = null;
let senderResult:
  | { from: string; replyTo: string; connected: boolean; unknown?: boolean }
  | Error = {
  from: "BROST CO <hello@brostco.com>",
  replyTo: "hello@brostco.com",
  connected: true,
};

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
  query: async (sql: string, params?: unknown[]) => {
    if (/follow_up_at is not null/.test(sql)) return dbRows.followUps;
    if (/set send_error = \$2/.test(sql) && typeof params?.[1] === "string") {
      sendErrors.push(params[1]);
    }
    return [];
  },
}));

vi.mock("../lib/impersonation", () => ({ currentImpersonator: async () => null }));
vi.mock("../lib/logger", () => ({ logAgent: async () => {} }));

vi.mock("../lib/integrations/gmail", () => ({
  gmail: {
    isConnected: async () => {
      if (gmailConnectionError) throw gmailConnectionError;
      return true;
    },
    send: async (params: { from?: string; replyTo?: string; to: string }) => {
      sends.push(params);
      if (gmailSendError) throw gmailSendError;
      return { messageId: "m1", threadId: "t1", rfc822MessageId: "<m1@mail>" };
    },
  },
}));

vi.mock("../lib/domain/sender-identity", () => ({
  resolveOutreachSender: async () => {
    if (senderResult instanceof Error) throw senderResult;
    return senderResult;
  },
}));

const { sendApprovedOutreach, sendFollowUps } = await import("../lib/backlink-send");

beforeEach(() => {
  sends.length = 0;
  sendErrors.length = 0;
  gmailConnectionError = null;
  gmailSendError = null;
  senderResult = {
    from: "BROST CO <hello@brostco.com>",
    replyTo: "hello@brostco.com",
    connected: true,
  };
});

afterEach(() => {
  vi.restoreAllMocks();
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
  it("blocks an approved send and records an actionable error", async () => {
    senderResult = { from: "", replyTo: "", connected: false, unknown: true };

    const out = await sendApprovedOutreach("o1", "org-1");

    expect(out).toMatchObject({
      status: "error",
      reason: expect.stringContaining("No email was sent"),
    });
    expect(sends).toHaveLength(0);
    expect(sendErrors).toEqual([expect.stringContaining("account settings could not be read")]);
  });

  it("also blocks a thrown identity lookup instead of omitting From", async () => {
    senderResult = new Error("database unavailable");

    const out = await sendApprovedOutreach("o1", "org-1");

    expect(out.status).toBe("error");
    expect(sends).toHaveLength(0);
  });

  it("turns an unreadable Gmail connection into a visible unsent outcome", async () => {
    gmailConnectionError = new Error("token row unavailable");

    const out = await sendApprovedOutreach("o1", "org-1");

    expect(out).toMatchObject({
      status: "error",
      reason: expect.stringContaining("Gmail connection could not be checked"),
    });
    expect(sends).toHaveLength(0);
    expect(sendErrors).toHaveLength(1);
  });

  it("reports unconfirmed delivery and tells the operator to check Sent before retrying", async () => {
    gmailSendError = new Error("connection state unavailable");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const out = await sendApprovedOutreach("o1", "org-1");

    expect(out).toMatchObject({
      status: "error",
      reason: expect.stringContaining("Check the Gmail Sent folder before retrying"),
    });
    expect(sendErrors).toHaveLength(1);
  });

  it("blocks every due follow-up and reports each unsent item to the sweep", async () => {
    senderResult = { from: "", replyTo: "", connected: false };

    const out = await sendFollowUps("org-1");

    expect(out).toEqual({ sent: 0, errors: 1 });
    expect(sends).toHaveLength(0);
    expect(sendErrors).toEqual([expect.stringContaining("No verified sender identity")]);
  });
});
