import { afterEach, describe, expect, it, vi } from "vitest";

interface LoadOptions {
  activeTrades?: Array<{ trade: string | null }>;
  priorThankYou?: boolean;
}

async function load(options: LoadOptions = {}) {
  vi.resetModules();
  const query = vi.fn(async (sql: string) => {
    if (/select distinct os\.trade/.test(sql)) {
      return options.activeTrades ?? [{ trade: "HVAC" }];
    }
    return [];
  });
  const queryOne = vi.fn(async (sql: string) => {
    if (/select o\.org_id/.test(sql)) return { org_id: "org-1" };
    if (/meta->>'kind' = 'decline_thank_you'/.test(sql)) {
      return options.priorThankYou ? { id: "prior" } : null;
    }
    if (/select email, owner_name, company_name/.test(sql)) {
      return {
        email: "old-contact@example.test",
        owner_name: "Dana Builder",
        company_name: "Builder Co",
      };
    }
    if (/select title from opportunities/.test(sql)) return { title: "Cooling upgrade" };
    return null;
  });
  const logAgent = vi.fn(async () => undefined);
  vi.doMock("@/lib/db", () => ({ query, queryOne }));
  vi.doMock("@/lib/logger", () => ({ logAgent }));
  vi.doMock("@/lib/integrations/email-transport", () => ({
    sendOutreachEmail: vi.fn(),
  }));
  vi.doMock("@/lib/ai/companyProfile", () => ({
    getProfileJson: vi.fn(async () => ({ legal_name: "Prime Co" })),
  }));
  vi.doMock("@/lib/domain/solicitation-completeness", () => ({
    outreachDisplayName: vi.fn(() => "Alex Prime"),
  }));
  return {
    mod: await import("@/lib/domain/decline-closeout"),
    query,
    queryOne,
    logAgent,
  };
}

afterEach(() => {
  vi.doUnmock("@/lib/db");
  vi.doUnmock("@/lib/logger");
  vi.doUnmock("@/lib/integrations/email-transport");
  vi.doUnmock("@/lib/ai/companyProfile");
  vi.doUnmock("@/lib/domain/solicitation-completeness");
  vi.resetModules();
});

describe("decline closeout email", () => {
  it("threads to the real reply participant and persists Gmail plus RFC ids", async () => {
    const { mod, query } = await load();
    const sendEmail = vi.fn(async () => ({
      provider: "gmail" as const,
      messageId: "gmail-api-2",
      threadId: "thread-1",
      rfc822MessageId: "<ours-2@example.test>",
    }));

    const result = await mod.closeOutDeclinedSub({
      orgId: "org-1",
      opportunityId: "opp-1",
      subcontractorId: "sub-1",
      trade: "HVAC",
      source: "email_reply",
      sendThankYou: true,
      recipientEmail: "replying-person@example.test",
      threadId: "thread-1",
      inReplyTo: "<theirs-1@example.test>",
      references: ["<ours-1@example.test>"],
      originalSubject: "Re: HVAC quote request",
      sendEmail,
    });

    expect(result.thankYouSent).toBe(true);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "replying-person@example.test",
        subject: "Re: HVAC quote request",
        orgId: "org-1",
        opportunityId: "opp-1",
        subcontractorId: "sub-1",
        trade: "HVAC",
        threadId: "thread-1",
        inReplyTo: "<theirs-1@example.test>",
        references: ["<ours-1@example.test>"],
      })
    );
    const stored = query.mock.calls.find(([sql]) => /insert into communications/.test(sql));
    expect(stored?.[1]).toEqual(
      expect.arrayContaining([
        "org-1",
        "gmail-api-2",
        "thread-1",
        "<ours-2@example.test>",
        "replying-person@example.test",
      ])
    );
  });

  it("blocks closeout and email after the pairing was removed", async () => {
    const { mod } = await load({ activeTrades: [] });
    const sendEmail = vi.fn();
    await expect(
      mod.closeOutDeclinedSub({
        orgId: "org-1",
        opportunityId: "opp-1",
        subcontractorId: "sub-1",
        trade: "HVAC",
        source: "email_reply",
        sendThankYou: true,
        sendEmail,
      })
    ).rejects.toThrow(/no longer active/i);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("requires a trade when several active pairings exist", async () => {
    const { mod } = await load({
      activeTrades: [{ trade: "HVAC" }, { trade: "Electrical" }],
    });
    await expect(
      mod.closeOutDeclinedSub({
        orgId: "org-1",
        opportunityId: "opp-1",
        subcontractorId: "sub-1",
        source: "call_workspace",
        sendThankYou: false,
      })
    ).rejects.toThrow(/several trades/i);
  });
});
