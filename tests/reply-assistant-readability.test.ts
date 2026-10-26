/**
 * Bulldog-class replies: a short "Pass" from a shared company mailbox must be
 * readable as a decline, and an assistant failure must say why it failed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractedReply } from "../lib/ai/reply-extract";

const h = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  logAgent: vi.fn(async () => undefined),
  claudeEnabled: vi.fn(async () => true),
  completeJson: vi.fn(),
}));

vi.mock("../lib/db", () => ({ query: h.query, queryOne: h.queryOne }));
vi.mock("../lib/logger", () => ({ logAgent: h.logAgent }));
vi.mock("../lib/queue", () => ({ enqueue: vi.fn(async () => "job-1") }));
vi.mock("../lib/reply-quote", () => ({ persistReplyQuote: vi.fn() }));
vi.mock("../lib/auth", () => ({ currentUser: vi.fn(async () => null) }));
vi.mock("../lib/reply-processing-lock", () => ({
  assertReplyProcessingOwnership: async () => {},
  withReplyProcessingLock: async (_org: string, _id: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("../lib/ai/claude", () => ({
  claudeEnabled: h.claudeEnabled,
  completeJson: h.completeJson,
}));

import { stripHtml } from "../lib/integrations/gmail";
import { classifyReplyNotice } from "../lib/domain/reply-notice";
import { decideReply } from "../lib/domain/reply-outcome";
import { extractReplyFromReply } from "../lib/ai/reply-extract";
import { captureReply } from "../lib/reply-capture";

const aiDecline = {
  intent: "decline" as const,
  is_quote: false,
  quote_amount: null,
  payment_terms: null,
  notes: "They passed.",
  company_name: "Bulldog Rooter, LLC",
  can_perform: false,
  capability_notes: "Passed on this request.",
  trades_mentioned: [] as string[],
  scope_summary: null,
  labor_cost: null,
  material_cost: null,
  taxes_amount: null,
  freight_amount: null,
  mobilization_amount: null,
  bonding_amount: null,
  exclusions: [] as string[],
  qualifications: [] as string[],
  lead_time_days: null,
  availability_notes: null,
  quote_valid_until: null,
  price_is_firm: null,
  taxes_included: null,
  alternates: [] as string[],
  earliest_start: null,
  covers_full_scope: null,
  uncovered_scope: null,
  referred_to: null,
  missing_fields: [] as string[],
  conflicts: [] as string[],
  confidence: 0.92,
};

function reading(over: Partial<ExtractedReply> = {}): ExtractedReply {
  return {
    intent: "other",
    isQuote: false,
    quoteAmount: null,
    paymentTerms: null,
    notes: null,
    companyName: null,
    canPerform: null,
    capabilityNotes: null,
    tradesMentioned: [],
    scopeSummary: null,
    laborCost: null,
    materialCost: null,
    taxesAmount: null,
    freightAmount: null,
    mobilizationAmount: null,
    bondingAmount: null,
    exclusions: [],
    qualifications: [],
    leadTimeDays: null,
    availabilityNotes: null,
    quoteValidUntil: null,
    priceIsFirm: null,
    taxesIncluded: null,
    alternates: [],
    earliestStart: null,
    coversFullScope: null,
    uncoveredScope: null,
    referredTo: null,
    missingFields: [],
    conflicts: [],
    confidence: 0,
    method: "regex",
    ...over,
  };
}

const bulldog = {
  id: "out-1",
  subcontractor_id: "sub-1",
  opportunity_id: "opp-1",
  company_name: "Bulldog Rooter, LLC",
  sub_email: "chris@bulldogrooter.com",
  opportunity_title: "H379 Mann-Grandstaff VA Medical Center Kitchen Equipment",
  trade: "Plumbing",
};

const passHtml = [
  "<div>Pass</div>",
  "<div>Best,</div>",
  "<div>Chris Allen</div>",
  "<div>General Manager</div>",
  "<div>Bulldog Rooter, LLC</div>",
  "<div>From: Prime &lt;bids@brostco.test&gt;<br>We will pass your request to estimating? Our quote is $100.</div>",
].join("");

beforeEach(() => {
  h.query.mockReset();
  h.queryOne.mockReset();
  h.logAgent.mockReset();
  h.claudeEnabled.mockReset();
  h.completeJson.mockReset();
  h.claudeEnabled.mockResolvedValue(true);
  h.query.mockImplementation(async (sql: string) => /select distinct trade/.test(sql) ? [{ trade: "Plumbing" }] : []);
  h.queryOne.mockImplementation(async (sql: string) => {
    if (/select o\.id from opportunities/.test(sql)) return { id: "opp-1" };
    if (/insert into communications/.test(sql)) return { id: "in-1" };
    if (/email_aliases/.test(sql)) return { email_aliases: [] };
    return null;
  });
});

describe("HTML Pass plus signature", () => {
  it("keeps the refusal on its own line so a quoted thread cannot change it", () => {
    const text = stripHtml(passHtml);
    expect(text).toContain("Pass\n");
    expect(text).toMatch(/\nFrom: Prime <bids@brostco\.test>/);
    const notice = classifyReplyNotice({ body: text });
    expect(notice.kind).toBe("decline");
    expect(notice.authoredText).not.toMatch(/\$100|estimating/);
    expect(notice.authoredText).toMatch(/^Pass\b/);
  });
});

describe("assistant extract telemetry", () => {
  it("records that the assistant is not configured instead of a silent regex miss", async () => {
    h.claudeEnabled.mockResolvedValue(false);
    const extracted = await extractReplyFromReply("Pass\nBest,\nChris Allen", {
      orgId: "org-1",
      messageId: "m-unconfigured",
    });
    expect(h.completeJson).not.toHaveBeenCalled();
    expect(extracted).toMatchObject({
      method: "regex",
      aiExtractStatus: "not_configured",
      aiExtractError: null,
      bodyPresent: true,
    });
    const decision = decideReply(extracted);
    expect(decision.act).toBe(false);
    expect(decision.reviewReason).toContain("not configured");
    expect(decision.reviewReason).not.toContain("Could not be read by the assistant");
    expect(h.logAgent).toHaveBeenCalledWith(expect.objectContaining({
      action: "reply-extract-not-configured",
      input: expect.objectContaining({ orgId: "org-1", messageId: "m-unconfigured" }),
    }));
  });

  it("logs a thrown reading and does not claim the body was unreadable", async () => {
    h.completeJson.mockRejectedValue(Object.assign(new Error("schema rejected the object"), { name: "ZodError" }));
    const extracted = await extractReplyFromReply("Pass\nBest,\nChris Allen", {
      orgId: "org-9",
      messageId: "m-throw",
    });
    expect(h.completeJson).toHaveBeenCalledTimes(1);
    expect(extracted).toMatchObject({
      method: "regex",
      aiExtractStatus: "failed",
      aiExtractErrorRetryable: false,
      bodyPresent: true,
    });
    expect(extracted.aiExtractError).toContain("schema rejected");
    expect(h.logAgent).toHaveBeenCalledWith(expect.objectContaining({
      action: "reply-extract-failed",
      status: "error",
      input: expect.objectContaining({
        orgId: "org-9",
        messageId: "m-throw",
        errorName: "ZodError",
        retryable: false,
      }),
    }));
    const decision = decideReply(extracted);
    expect(decision.reviewReason).toContain("failed to read");
    expect(decision.reviewReason).toContain("schema rejected");
    expect(decision.reviewReason).not.toContain("Could not be read by the assistant");
  });

  it("retries once when the provider failure is retryable, then keeps the reading", async () => {
    h.completeJson
      .mockRejectedValueOnce(Object.assign(new Error("temporary outage"), {
        name: "ClaudeUnavailableError",
        reason: "Anthropic temporarily refused this request because the API is overloaded.",
        retryable: true,
      }))
      .mockResolvedValueOnce({ data: aiDecline, usage: {} });
    const extracted = await extractReplyFromReply("We cannot take this kitchen job.", {
      orgId: "org-1",
      messageId: "m-retry",
    });
    expect(h.completeJson).toHaveBeenCalledTimes(2);
    expect(extracted.method).toBe("ai");
    expect(extracted.aiExtractStatus).toBe("ok");
    expect(extracted.intent).toBe("decline");
    expect(h.logAgent).toHaveBeenCalledWith(expect.objectContaining({
      action: "reply-extract-failed",
      input: expect.objectContaining({ retryable: true, attempt: 0 }),
    }));
  });

  it("does not call a readable body unreadable merely because the method is regex", () => {
    const decision = decideReply(reading({ bodyPresent: true, confidence: 1, intent: "decline" }));
    expect(decision.act).toBe(false);
    expect(decision.outcome).toBe("unclear");
    expect(decision.reviewReason).toContain("readable body");
    expect(decision.reviewReason).not.toContain("Could not be read by the assistant");
  });
});

describe("Bulldog capture", () => {
  it("auto-declines Pass from dispatch@ when the roster contact is chris@ the same company", async () => {
    const extract = vi.fn();
    const closeOut = vi.fn(async () => ({ thankYouSent: false, alreadyThanked: false }));
    const result = await captureReply({
      orgId: "org-1",
      comm: bulldog,
      strongMatch: true,
      fromEmail: "dispatch@bulldogrooter.com",
      replyText: stripHtml(passHtml),
      messageId: "gmail-bulldog",
      extract,
      closeOut,
    });
    expect(extract).not.toHaveBeenCalled();
    expect(result.senderVerified).toBe(true);
    expect(result.declined).toBe(true);
    expect(result.decision).toMatchObject({ act: true, needsReview: false, reviewReason: null });
    expect(closeOut).toHaveBeenCalledWith(expect.objectContaining({
      recipientEmail: "dispatch@bulldogrooter.com",
      subcontractorId: "sub-1",
    }));
  });

  it("denies a different freemail mailbox even on a strong match", async () => {
    const result = await captureReply({
      orgId: "org-1",
      comm: { ...bulldog, sub_email: "chris@gmail.com" },
      strongMatch: true,
      fromEmail: "dispatch@gmail.com",
      replyText: "Pass",
      messageId: "gmail-freemail",
      extract: vi.fn(async () => reading({ intent: "decline", confidence: 0.9, method: "ai", aiExtractStatus: "ok", bodyPresent: true })),
      closeOut: vi.fn(async () => ({ thankYouSent: true, alreadyThanked: false })),
    });
    expect(result.senderVerified).toBe(false);
    expect(result.declined).toBe(false);
    expect(result.decision.reviewReason).toContain("sender address differs");
  });

  it("keeps both review reasons when the assistant fails and the sender is a different company", async () => {
    const result = await captureReply({
      orgId: "org-1",
      comm: bulldog,
      strongMatch: true,
      fromEmail: "other@gmail.com",
      replyText: "Can you send the drawings before Friday?",
      messageId: "gmail-both-gates",
      extract: async () => reading({
        aiExtractStatus: "failed",
        aiExtractError: "Anthropic temporarily refused this request because the API is overloaded.",
        aiExtractErrorRetryable: true,
        bodyPresent: true,
      }),
    });
    expect(result.decision.needsReview).toBe(true);
    expect(result.decision.act).toBe(false);
    expect(result.decision.reviewReason).toContain("failed to read");
    expect(result.decision.reviewReason).toContain("overloaded");
    expect(result.decision.reviewReason).toContain("sender address differs");
    expect(result.decision.reviewReason).not.toContain("Could not be read by the assistant");
    const metaWrite = h.query.mock.calls.find(([sql]) => /meta=meta \|\| \$4::jsonb/.test(String(sql)));
    const meta = JSON.parse(String(metaWrite?.[1]?.[3]));
    expect(meta).toMatchObject({
      ai_extract_error: expect.stringContaining("overloaded"),
      ai_extract_error_retryable: true,
      ai_enabled: true,
      ai_extract_status: "failed",
      reply_sender_verified: false,
      reply_strong_match: true,
    });
  });

  it("treats a snippet-only Pass as an unreadable body, not a pattern-matched decline", async () => {
    const extract = vi.fn();
    const closeOut = vi.fn(async () => ({ thankYouSent: true, alreadyThanked: false }));
    const result = await captureReply({
      orgId: "org-1",
      comm: bulldog,
      strongMatch: true,
      fromEmail: "dispatch@bulldogrooter.com",
      replyText: "Pass",
      messageId: "gmail-snippet-pass",
      unreadableBody: true,
      extract,
      closeOut,
    });
    expect(extract).not.toHaveBeenCalled();
    expect(closeOut).not.toHaveBeenCalled();
    expect(result.declined).toBe(false);
    expect(result.decision.act).toBe(false);
    expect(result.decision.reviewReason).toContain("original message body could not be read");
    expect(result.decision.reviewReason).not.toContain("only pattern-matched");
  });
});
