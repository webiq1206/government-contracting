import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * Sending a reply from the conversation view.
 *
 * The thing worth proving here is the clean-up: once the mail is actually
 * gone, the suggested draft it came from has to be destroyed in the same
 * request. Left behind, it reappears in the reply box on the next page load
 * looking like unsent work, and the operator sends the sub the same email
 * twice. Doing it from the browser afterwards is not good enough, because the
 * one case that matters is the tab being closed the moment Send is pressed.
 */

const SUB = { id: "s1", company_name: "Acme Paving", email: "dana@acme.example" };

interface RouteOpts {
  send?: () => Promise<Record<string, unknown>>;
}

async function load(opts: RouteOpts = {}) {
  vi.resetModules();
  const query = vi.fn(async () => [] as unknown[]);
  const queryOne = vi.fn(async (sql: string) => {
    if (/from subcontractors/.test(sql)) return SUB;
    if (/from opportunity_subs/.test(sql)) return { opportunity_id: "o1" };
    return null;
  });
  const sendOutreachEmail = vi.fn(
    opts.send ?? (async () => ({ provider: "gmail", messageId: "m9", threadId: "t-1" }))
  );

  vi.doMock("@/lib/api-auth", () => ({
    requireSubscriber: vi.fn(async () => ({ id: "u1", organizationId: "org-1" })),
  }));
  vi.doMock("@/lib/tenant", () => ({ resolveTenantOrgId: vi.fn(async () => "org-1") }));
  vi.doMock("@/lib/db", () => ({ query, queryOne }));
  vi.doMock("@/lib/integrations/email-transport", () => ({ sendOutreachEmail }));
  vi.doMock("@/lib/logger", () => ({ logAgent: vi.fn(async () => {}) }));

  const route = await import("@/app/api/conversations/reply/route");
  return { route, query, sendOutreachEmail };
}

function post(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/conversations/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const BODY = {
  subcontractorId: "s1",
  opportunityId: "o1",
  threadId: "t-1",
  inReplyTo: "g-1",
  message: "Dana, it's 42,000 square feet. Jared",
};

afterEach(() => {
  vi.doUnmock("@/lib/api-auth");
  vi.doUnmock("@/lib/tenant");
  vi.doUnmock("@/lib/db");
  vi.doUnmock("@/lib/integrations/email-transport");
  vi.doUnmock("@/lib/logger");
  vi.resetModules();
});

function deleteCalls(query: { mock: { calls: unknown[][] } }) {
  return query.mock.calls.filter((c) => /delete from reply_drafts/.test(c[0] as string));
}

describe("sending a reply", () => {
  it("destroys the draft it came from, in the same request", async () => {
    const { route, query } = await load();
    const res = await route.POST(post(BODY));
    expect(res.status).toBe(200);

    const del = deleteCalls(query);
    expect(del).toHaveLength(1);
    // Scoped to this tenant and this thread, not to every draft for the sub.
    expect(del[0][1]).toEqual(["s1", "t-1", "o1", "org-1"]);
  });

  it("keeps the draft when the mail did not go out", async () => {
    const { route, query } = await load({
      send: async () => ({ provider: null, error: "Gmail is unreachable." }),
    });
    const res = await route.POST(post(BODY));
    expect(res.status).toBe(502);
    // Nothing was sent, so the operator's text is still the only copy.
    expect(deleteCalls(query)).toHaveLength(0);
  });

  it("cleans up threads that predate Gmail threading too", async () => {
    const { route, query } = await load({
      send: async () => ({ provider: "gmail", messageId: "m9", threadId: null }),
    });
    await route.POST(post({ ...BODY, threadId: null }));
    const del = deleteCalls(query);
    expect(del).toHaveLength(1);
    // Null thread id falls back to the solicitation key, matching how the
    // conversation view groups these messages.
    expect(del[0][1]).toEqual(["s1", null, "o1", "org-1"]);
  });

  it("refuses to send an empty message rather than mailing whitespace", async () => {
    const { route, sendOutreachEmail } = await load();
    const res = await route.POST(post({ ...BODY, message: "   " }));
    expect(res.status).toBe(400);
    expect(sendOutreachEmail).not.toHaveBeenCalled();
  });
});
