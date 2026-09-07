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
  activePairs?: { trade: string | null }[];
  messages?: Array<Record<string, unknown>>;
  recovered?: { rfc822MessageId: string | null; references: string[] };
}

async function load(opts: RouteOpts = {}) {
  vi.resetModules();
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (/from communications c/.test(sql) && /order by c\.created_at asc/.test(sql)) {
      return opts.messages ?? [
        {
          id: "in-1",
          direction: "inbound",
          subject: "Re: Quote request",
          recipient_email: "Dana <original@acme.example>",
          gmail_thread_id: params?.[2] ?? null,
          rfc822_message_id: "<theirs-1@mail.example>",
          opportunity_id: "o1",
          meta: { trade: "HVAC" },
        },
      ];
    }
    if (/from opportunity_subs os/.test(sql)) {
      return opts.activePairs ?? [{ trade: "HVAC" }];
    }
    return [] as unknown[];
  });
  const queryOne = vi.fn(async (sql: string) => {
    if (/from subcontractors/.test(sql)) return SUB;
    return null;
  });
  const sendOutreachEmail = vi.fn(
    opts.send ??
      (async () => ({
        provider: "gmail",
        messageId: "m9",
        threadId: "t-1",
        rfc822MessageId: "<ours-2@mail.example>",
      }))
  );

  vi.doMock("@/lib/api-auth", () => ({
    // The route guards with requireCapability("outreach") now. These tests are
    // about what the handler does once past the guard, so the stand-in is a
    // permitted user; tests/roles.test.ts and the route-coverage test cover
    // the refusal itself.
    requireSubscriber: vi.fn(async () => ({ id: "u1", orgRole: "owner", organizationId: "org-1" })),
    requireCapability: vi.fn(async () => ({ id: "u1", orgRole: "owner", organizationId: "org-1" })),
    requireUser: vi.fn(async () => ({ id: "u1", orgRole: "owner", organizationId: "org-1" })),
  }));
  vi.doMock("@/lib/tenant", () => ({ resolveTenantOrgId: vi.fn(async () => "org-1") }));
  vi.doMock("@/lib/db", () => ({ query, queryOne }));
  vi.doMock("@/lib/integrations/email-transport", () => ({ sendOutreachEmail }));
  const threadMessageId = vi.fn(async () =>
    (opts.recovered ?? { rfc822MessageId: null, references: [] })
  );
  vi.doMock("@/lib/integrations/gmail", () => ({
    gmail: {
      threadMessageId,
    },
  }));
  vi.doMock("@/lib/logger", () => ({ logAgent: vi.fn(async () => {}) }));

  const route = await import("@/app/api/conversations/reply/route");
  return { route, query, sendOutreachEmail, threadMessageId };
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
  vi.doUnmock("@/lib/integrations/gmail");
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

  it("derives the recipient, RFC headers, and workflow context from the stored thread", async () => {
    const { route, sendOutreachEmail, query } = await load();
    const res = await route.POST(
      post({ ...BODY, inReplyTo: "attacker-controlled", opportunityId: "o1" })
    );
    expect(res.status).toBe(200);
    expect(sendOutreachEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "original@acme.example",
        threadId: "t-1",
        inReplyTo: "<theirs-1@mail.example>",
        references: ["<theirs-1@mail.example>"],
        orgId: "org-1",
        opportunityId: "o1",
        subcontractorId: "s1",
        trade: "HVAC",
      })
    );
    const insert = query.mock.calls.find(([sql]) => /insert into communications/.test(sql));
    expect(insert?.[1]).toContain("<ours-2@mail.example>");
  });

  it("recovers the newest RFC id from Gmail for a legacy stored thread", async () => {
    const messages = [
      {
        id: "in-1",
        direction: "inbound",
        subject: "Re: Quote request",
        recipient_email: "original@acme.example",
        gmail_thread_id: "t-1",
        rfc822_message_id: null,
        opportunity_id: "o1",
        meta: { trade: "HVAC" },
      },
    ];
    const { route, sendOutreachEmail, threadMessageId } = await load({
      messages,
      recovered: {
        rfc822MessageId: "<legacy-inbound@mail.example>",
        references: ["<outbound@mail.example>", "<legacy-inbound@mail.example>"],
      },
    });
    const res = await route.POST(post(BODY));

    expect(res.status).toBe(200);
    expect(threadMessageId).toHaveBeenCalledWith("t-1", "org-1", {
      preferLatestSent: false,
    });
    expect(sendOutreachEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        inReplyTo: "<legacy-inbound@mail.example>",
        references: ["<outbound@mail.example>", "<legacy-inbound@mail.example>"],
      })
    );
  });

  it("refuses a stored thread that crosses opportunity contexts", async () => {
    const base = {
      direction: "inbound",
      subject: "Re: Quote request",
      recipient_email: "original@acme.example",
      gmail_thread_id: "t-1",
      rfc822_message_id: "<theirs@mail.example>",
      meta: { trade: "HVAC" },
    };
    const { route, sendOutreachEmail } = await load({
      messages: [
        { ...base, id: "one", opportunity_id: "o1" },
        { ...base, id: "two", opportunity_id: "o2" },
      ],
    });
    const res = await route.POST(post({ ...BODY, opportunityId: null }));

    expect(res.status).toBe(409);
    expect(sendOutreachEmail).not.toHaveBeenCalled();
  });

  it("refuses a stored thread that crosses trade contexts", async () => {
    const base = {
      direction: "inbound",
      subject: "Re: Quote request",
      recipient_email: "original@acme.example",
      gmail_thread_id: "t-1",
      rfc822_message_id: "<theirs@mail.example>",
      opportunity_id: "o1",
    };
    const { route, sendOutreachEmail } = await load({
      messages: [
        { ...base, id: "one", meta: { trade: "HVAC" } },
        { ...base, id: "two", meta: { trade: "Electrical" } },
      ],
    });
    const res = await route.POST(post(BODY));

    expect(res.status).toBe(409);
    expect(sendOutreachEmail).not.toHaveBeenCalled();
  });

  it("does not fall back to a malformed stored sender address", async () => {
    const { route, sendOutreachEmail } = await load({
      messages: [
        {
          id: "in-1",
          direction: "inbound",
          subject: "Re: Quote request",
          recipient_email: "not an email",
          gmail_thread_id: "t-1",
          rfc822_message_id: "<theirs@mail.example>",
          opportunity_id: "o1",
          meta: { trade: "HVAC" },
        },
      ],
    });
    const res = await route.POST(post(BODY));

    expect(res.status).toBe(400);
    expect(sendOutreachEmail).not.toHaveBeenCalled();
  });

  it("does not send after the trade pairing was removed", async () => {
    const { route, sendOutreachEmail } = await load({ activePairs: [] });
    const res = await route.POST(post(BODY));
    expect(res.status).toBe(409);
    expect(sendOutreachEmail).not.toHaveBeenCalled();
  });

  it("refuses to send an empty message rather than mailing whitespace", async () => {
    const { route, sendOutreachEmail } = await load();
    const res = await route.POST(post({ ...BODY, message: "   " }));
    expect(res.status).toBe(400);
    expect(sendOutreachEmail).not.toHaveBeenCalled();
  });
});
