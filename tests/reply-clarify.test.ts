import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * This module sends email on the customer's behalf, automatically. The
 * guardrails matter more than the copy: never chase someone who said no, never
 * ask twice, and never send when there is nothing to ask for.
 */
async function load(opts: { alreadyAsked?: boolean; send?: ReturnType<typeof vi.fn> } = {}) {
  vi.resetModules();
  const send = opts.send ?? vi.fn(async () => ({ provider: "gmail", messageId: "m1", threadId: "t1" }));
  vi.doMock("@/lib/db", () => ({
    query: vi.fn(async () => []),
    queryOne: vi.fn(async () => (opts.alreadyAsked ? { id: "prior" } : null)),
  }));
  vi.doMock("@/lib/integrations/email-transport", () => ({ sendOutreachEmail: send }));
  const mod = await import("@/lib/domain/reply-clarify");
  return { mod, send };
}

afterEach(() => {
  vi.doUnmock("@/lib/db");
  vi.doUnmock("@/lib/integrations/email-transport");
  vi.resetModules();
});

const BASE = {
  opportunityId: "o1",
  subcontractorId: "s1",
  toEmail: "sub@example.com",
  companyName: "Acme",
  opportunityTitle: "Grounds maintenance",
  gaps: ["price", "lead_time"],
  outcome: "quoted" as const,
};

describe("clarification requests", () => {
  it("asks only for what is missing, in plain language", async () => {
    const { mod, send } = await load();
    const res = await mod.requestClarification(BASE);
    expect(res.sent).toBe(true);
    const body = send.mock.calls[0][0].text as string;
    expect(body).toContain("your total price for the work");
    expect(body).toContain("how soon you could start");
    expect(body).not.toContain("lead_time");
  });

  it("replies inside the existing thread", async () => {
    const { mod, send } = await load();
    await mod.requestClarification({ ...BASE, threadId: "T", inReplyToMessageId: "M" });
    expect(send.mock.calls[0][0]).toMatchObject({ threadId: "T", inReplyTo: "M" });
  });

  it("never chases someone who declined or is unavailable", async () => {
    const { mod, send } = await load();
    for (const outcome of ["declined", "unavailable", "not_a_fit"] as const) {
      expect((await mod.requestClarification({ ...BASE, outcome })).sent).toBe(false);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("does not ask twice for the same solicitation", async () => {
    const { mod, send } = await load({ alreadyAsked: true });
    expect((await mod.requestClarification(BASE)).sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends nothing when there is no gap and no address", async () => {
    const { mod, send } = await load();
    expect((await mod.requestClarification({ ...BASE, gaps: [] })).sent).toBe(false);
    expect((await mod.requestClarification({ ...BASE, toEmail: "" })).sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("reports failure instead of claiming a send that did not happen", async () => {
    const send = vi.fn(async () => ({ provider: null, disabled: true, error: "No inbox connected." }));
    const { mod } = await load({ send });
    const res = await mod.requestClarification(BASE);
    expect(res.sent).toBe(false);
    expect(res.reason).toContain("No inbox connected");
  });
});
