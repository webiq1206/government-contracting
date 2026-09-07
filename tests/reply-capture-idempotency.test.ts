import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtractedReply } from "@/lib/ai/reply-extract";

const query = vi.fn();
const queryOne = vi.fn();

async function load() {
  vi.resetModules();
  query.mockReset();
  queryOne.mockReset();
  vi.doMock("@/lib/db", () => ({ query, queryOne }));
  vi.doMock("@/lib/queue", () => ({ enqueue: vi.fn(async () => null) }));
  vi.doMock("@/lib/logger", () => ({ logAgent: vi.fn(async () => undefined) }));
  vi.doMock("@/lib/auth", () => ({ currentUser: vi.fn(async () => null) }));
  return import("@/lib/reply-capture");
}

afterEach(() => {
  vi.doUnmock("@/lib/db");
  vi.doUnmock("@/lib/queue");
  vi.doUnmock("@/lib/logger");
  vi.doUnmock("@/lib/auth");
  vi.resetModules();
});

const comm = {
  id: "out-1",
  subcontractor_id: "sub-1",
  opportunity_id: "opp-1",
  company_name: "Acme Electric",
  sub_email: "quotes@acme.example",
  opportunity_title: "Panel replacement",
  trade: "Electrical",
};

function extracted(intent: ExtractedReply["intent"]): ExtractedReply {
  return {
    intent,
    isQuote: false,
    quoteAmount: null,
    paymentTerms: null,
    notes: null,
    companyName: null,
    canPerform: intent === "decline" ? false : true,
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
    confidence: 0.99,
    method: "ai",
  };
}

describe("reply capture ownership and weak matching", () => {
  it("lets only the INSERT winner perform downstream side effects", async () => {
    const mod = await load();
    query.mockImplementation(async (sql: string) =>
      /select distinct trade/.test(sql) ? [{ trade: "Electrical" }] : []
    );
    queryOne.mockImplementation(async (sql: string) => {
      if (/select o.id from opportunities/.test(sql)) return { id: "opp-1" };
      if (/select id, subcontractor_id from communications/.test(sql)) return null;
      if (/insert into communications/.test(sql)) return null;
      return null;
    });
    const closeOut = vi.fn(async () => ({ thankYouSent: true, alreadyThanked: false }));

    const result = await mod.captureReply({
      orgId: "org-1",
      comm,
      strongMatch: true,
      fromEmail: "quotes@acme.example",
      replyText: "We will pass.",
      messageId: "gmail-in-1",
      extract: async () => extracted("decline"),
      closeOut,
    });

    expect(result.duplicate).toBe(true);
    expect(closeOut).not.toHaveBeenCalled();
    expect(
      query.mock.calls.some(([sql]) => /update opportunity_subs/.test(String(sql)))
    ).toBe(false);
    expect(
      query.mock.calls.some(([sql]) => /update communications set replied_at/.test(String(sql)))
    ).toBe(false);
  });

  it("does not guess when a sender-only match has two live conversations", async () => {
    const mod = await load();
    query.mockResolvedValue([
      comm,
      { ...comm, id: "out-2", opportunity_id: "opp-2" },
    ]);

    const result = await mod.matchInboundReply({
      orgId: "org-1",
      fromEmail: "quotes@acme.example",
    });

    expect(result).toEqual({ comm: null, strongMatch: false });
  });

  it("records a weakly matched decline but never closes or emails the firm", async () => {
    const mod = await load();
    query.mockImplementation(async (sql: string) =>
      /select distinct trade/.test(sql) ? [{ trade: "Electrical" }] : []
    );
    queryOne.mockImplementation(async (sql: string) => {
      if (/select o.id from opportunities/.test(sql)) return { id: "opp-1" };
      if (/select id, subcontractor_id from communications/.test(sql)) return null;
      if (/insert into communications/.test(sql)) return { id: "in-1" };
      return null;
    });
    const closeOut = vi.fn(async () => ({ thankYouSent: true, alreadyThanked: false }));

    const result = await mod.captureReply({
      orgId: "org-1",
      comm,
      strongMatch: false,
      fromEmail: "quotes@acme.example",
      replyText: "We will pass.",
      messageId: "gmail-in-2",
      extract: async () => extracted("decline"),
      closeOut,
    });

    expect(result.duplicate).toBe(false);
    expect(result.declined).toBe(false);
    expect(result.decision).toMatchObject({
      outcome: "unclear",
      act: false,
      needsReview: true,
    });
    expect(result.decision.reviewReason).toMatch(/sender address/i);
    expect(closeOut).not.toHaveBeenCalled();
    expect(
      query.mock.calls.some(([sql]) => /update opportunity_subs/.test(String(sql)))
    ).toBe(false);
  });

  it("records but never applies a reply after its pairing was removed", async () => {
    const mod = await load();
    query.mockImplementation(async (sql: string) =>
      /select distinct trade/.test(sql) ? [] : []
    );
    queryOne.mockImplementation(async (sql: string) => {
      if (/select o.id from opportunities/.test(sql)) return { id: "opp-1" };
      if (/select id, subcontractor_id from communications/.test(sql)) return null;
      if (/insert into communications/.test(sql)) return { id: "in-removed" };
      return null;
    });
    const closeOut = vi.fn(async () => ({ thankYouSent: true, alreadyThanked: false }));

    const result = await mod.captureReply({
      orgId: "org-1",
      comm,
      strongMatch: true,
      fromEmail: "quotes@acme.example",
      replyText: "We will pass.",
      messageId: "gmail-in-removed",
      extract: async () => extracted("decline"),
      closeOut,
    });

    expect(result.decision).toMatchObject({ act: false, needsReview: true });
    expect(result.decision.reviewReason).toMatch(/no longer active/i);
    expect(closeOut).not.toHaveBeenCalled();
    expect(
      query.mock.calls.some(([sql]) => /set outreach_state='responsive'/.test(String(sql)))
    ).toBe(false);
  });

  it("uses one explicitly named active trade instead of guessing among several", async () => {
    const mod = await load();
    query.mockImplementation(async (sql: string) =>
      /select distinct trade/.test(sql)
        ? [{ trade: "Electrical" }, { trade: "HVAC" }]
        : []
    );
    queryOne.mockImplementation(async (sql: string) => {
      if (/select o.id from opportunities/.test(sql)) return { id: "opp-1" };
      if (/select id, subcontractor_id from communications/.test(sql)) return null;
      if (/insert into communications/.test(sql)) return { id: "in-hvac" };
      return null;
    });
    const named = { ...extracted("interested"), tradesMentioned: ["HVAC"] };

    const result = await mod.captureReply({
      orgId: "org-1",
      comm: { ...comm, trade: null },
      strongMatch: true,
      fromEmail: "quotes@acme.example",
      replyText: "We can handle HVAC.",
      messageId: "gmail-in-hvac",
      extract: async () => named,
    });

    expect(result.trade).toBe("HVAC");
    expect(result.decision.act).toBe(true);
    const statusWrite = query.mock.calls.find(([sql]) =>
      /set outreach_state='responsive'/.test(String(sql))
    );
    expect(statusWrite?.[1]).toEqual(["opp-1", "sub-1", "HVAC"]);
  });
});
