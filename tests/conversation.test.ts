import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * Grouping is what turns a flat communications log into something a person can
 * read. The cases that matter are the messy ones: history that predates
 * threading, and knowing whose turn it is.
 */
async function load(rows: unknown[]) {
  vi.resetModules();
  const query = vi.fn(async () => rows);
  vi.doMock("@/lib/db", () => ({ query }));
  return { mod: await import("@/lib/domain/conversation"), query };
}

afterEach(() => {
  vi.doUnmock("@/lib/db");
  vi.resetModules();
});

const msg = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  direction: "outbound",
  subject: "Quote request",
  body: "Can you price this?",
  created_at: "2026-08-01T10:00:00Z",
  recipient_email: "sub@example.com",
  gmail_thread_id: "T1",
  gmail_message_id: "M1",
  rfc822_message_id: "<M1@example.test>",
  opportunity_id: "o1",
  opportunity_title: "Grounds maintenance",
  meta: null,
  ...over,
});

describe("grouping messages into conversations", () => {
  it("groups by Gmail thread", async () => {
    const { mod: m } = await load([
      msg(),
      msg({ id: "c2", direction: "inbound", gmail_message_id: "M2", created_at: "2026-08-01T12:00:00Z" }),
      msg({ id: "c3", gmail_thread_id: "T2", created_at: "2026-08-02T09:00:00Z" }),
    ]);
    const convs = await m.subConversations("s1", "org-1");
    expect(convs).toHaveLength(2);
    expect(convs.find((c) => c.threadId === "T1")!.messages).toHaveLength(2);
  });

  it("groups pre-threading history by solicitation instead of one per message", async () => {
    const { mod: m } = await load([
      msg({ id: "a", gmail_thread_id: null, gmail_message_id: null }),
      msg({ id: "b", gmail_thread_id: null, gmail_message_id: null, created_at: "2026-08-01T11:00:00Z" }),
    ]);
    const convs = await m.subConversations("s1", "org-1");
    expect(convs).toHaveLength(1);
    expect(convs[0].messages).toHaveLength(2);
  });

  it("orders conversations newest first and messages oldest first", async () => {
    const { mod: m } = await load([
      msg({ id: "old", gmail_thread_id: "T1", created_at: "2026-08-01T10:00:00Z" }),
      msg({ id: "older-same", gmail_thread_id: "T1", created_at: "2026-08-01T11:00:00Z" }),
      msg({ id: "new", gmail_thread_id: "T2", created_at: "2026-08-05T10:00:00Z" }),
    ]);
    const convs = await m.subConversations("s1", "org-1");
    expect(convs[0].threadId).toBe("T2");
    expect(convs[1].messages.map((x) => x.id)).toEqual(["old", "older-same"]);
  });
});

describe("knowing whose turn it is", () => {
  it("flags a conversation whose last message is theirs", async () => {
    const { mod: m } = await load([
      msg(),
      msg({ id: "c2", direction: "inbound", gmail_message_id: "M2", created_at: "2026-08-01T12:00:00Z" }),
    ]);
    expect((await m.subConversations("s1", "org-1"))[0].awaitingUs).toBe(true);
  });

  it("does not flag one we already answered", async () => {
    const { mod: m } = await load([
      msg({ id: "c1", direction: "inbound", gmail_message_id: "M1" }),
      msg({ id: "c2", direction: "outbound", created_at: "2026-08-01T12:00:00Z" }),
    ]);
    expect((await m.subConversations("s1", "org-1"))[0].awaitingUs).toBe(false);
  });

  it("replies to their newest message, not ours", async () => {
    const { mod: m } = await load([
      msg({
        id: "c1",
        direction: "inbound",
        gmail_message_id: "THEIRS-API-1",
        rfc822_message_id: "<THEIRS-1@example.test>",
      }),
      msg({ id: "c2", direction: "outbound", gmail_message_id: "OURS", created_at: "2026-08-01T11:00:00Z" }),
      msg({
        id: "c3",
        direction: "inbound",
        gmail_message_id: "THEIRS-API-2",
        rfc822_message_id: "<THEIRS-2@example.test>",
        created_at: "2026-08-01T12:00:00Z",
      }),
    ]);
    expect((await m.subConversations("s1", "org-1"))[0].replyToMessageId).toBe(
      "<THEIRS-2@example.test>"
    );
  });
});

describe("labelling", () => {
  it("carries the trade and the automatic-send marker through", async () => {
    const { mod: m } = await load([msg({ meta: { trade: "Landscaping", kind: "clarification" } })]);
    const c = (await m.subConversations("s1", "org-1"))[0];
    expect(c.trade).toBe("Landscaping");
    expect(c.messages[0].kind).toBe("clarification");
  });

  it("surfaces a database failure instead of showing a false empty history", async () => {
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({
      query: vi.fn(async () => {
        throw new Error("down");
      }),
    }));
    const m = await import("@/lib/domain/conversation");
    await expect(m.subConversations("s1", "org-1")).rejects.toThrow("down");
  });

  it("scopes both the communication and opportunity join to the account", async () => {
    const { mod: m, query } = await load([]);
    await m.subConversations("s1", "org-1");
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/c\.org_id = \$2[\s\S]*c\.subcontractor_id = \$1/),
      ["s1", "org-1"]
    );
  });
});
