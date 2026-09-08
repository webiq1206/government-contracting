import { afterEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const queryOne = vi.fn();
const transaction = vi.fn();
const clientQuery = vi.fn();
const applyOutcome = vi.fn();
const proposeRow = vi.fn();
const saveProposedRow = vi.fn();
const closeOut = vi.fn();
const advanceIfQuotesComplete = vi.fn();
const closeIfSubsExhausted = vi.fn();
const enqueue = vi.fn();
const logAgent = vi.fn();

const defaultEvent = {
  id: "event-1",
  subcontractor_id: "sub-1",
  opportunity_id: "opp-1",
  trade: null,
  extracted: {
    intent: "quote",
    isQuote: true,
    quoteAmount: 42_000,
    paymentTerms: "Net 30",
    notes: null,
    capabilityNotes: null,
    tradesMentioned: [],
  },
  created_at: new Date("2026-08-01T12:00:00Z"),
  needs_review: true,
  reviewed_at: null,
};

interface LoadOptions {
  event?: typeof defaultEvent | null;
  pairs?: { trade: string | null }[];
  claim?: boolean;
  finalize?: boolean;
  lockedPair?: boolean;
  quote?: { id: string } | null;
}

async function load(opts: LoadOptions = {}) {
  vi.resetModules();
  query.mockReset();
  queryOne.mockReset();
  transaction.mockReset();
  clientQuery.mockReset();
  applyOutcome.mockReset();
  proposeRow.mockReset();
  saveProposedRow.mockReset();
  closeOut.mockReset();
  advanceIfQuotesComplete.mockReset();
  closeIfSubsExhausted.mockReset();
  enqueue.mockReset();
  logAgent.mockReset();

  queryOne.mockImplementation(async (sql: string) => {
    if (/from subcontractor_reply_events e/.test(sql)) {
      return Object.prototype.hasOwnProperty.call(opts, "event")
        ? opts.event
        : defaultEvent;
    }
    if (/insert into quotes/.test(sql)) {
      return Object.prototype.hasOwnProperty.call(opts, "quote")
        ? opts.quote
        : { id: "quote-1" };
    }
    return null;
  });
  query.mockImplementation(async (sql: string) => {
    if (/select distinct os\.trade/.test(sql)) {
      return opts.pairs ?? [{ trade: "Electrical" }];
    }
    return [];
  });
  clientQuery.mockImplementation(async (sql: string) => {
    if (/for update of e/.test(sql)) {
      const event = Object.prototype.hasOwnProperty.call(opts, "event")
        ? opts.event
        : defaultEvent;
      if (!event) return { rows: [] };
      return {
        rows: [
          opts.claim === false
            ? { ...event, reviewed_at: new Date("2026-08-02T12:00:00Z") }
            : event,
        ],
      };
    }
    if (/set reviewed_at = now\(\), needs_review = false/.test(sql)) {
      return { rows: opts.finalize === false ? [] : [{ id: "event-1" }] };
    }
    if (/from opportunity_subs os/.test(sql) && /for update of os/.test(sql)) {
      return { rows: opts.lockedPair === false ? [] : [{ id: "pair-1" }] };
    }
    if (/insert into quotes/.test(sql)) {
      return {
        rows: [
          Object.prototype.hasOwnProperty.call(opts, "quote")
            ? opts.quote
            : { id: "quote-1" },
        ].filter(Boolean),
      };
    }
    if (/select q\.id/.test(sql)) return { rows: [{ id: "existing-quote-1" }] };
    return { rows: [] };
  });
  transaction.mockImplementation(
    async (fn: (client: { query: typeof clientQuery }) => unknown) =>
      fn({ query: clientQuery }),
  );
  applyOutcome.mockResolvedValue({
    applied: true,
    refused: null,
    candidateTrades: [],
  });
  saveProposedRow.mockResolvedValue("written");
  closeOut.mockResolvedValue({ thankYouSent: false, alreadyThanked: false });
  advanceIfQuotesComplete.mockResolvedValue({
    advanced: false,
    assessment: {},
  });
  closeIfSubsExhausted.mockResolvedValue({
    action: "none",
    exhaustedTrades: [],
  });
  enqueue.mockResolvedValue(null);
  logAgent.mockResolvedValue(undefined);

  vi.doMock("@/lib/api-auth", () => ({
    requireCapability: vi.fn(async () => ({
      id: "u1",
      email: "op@example.test",
    })),
  }));
  vi.doMock("@/lib/tenant", () => ({
    resolveTenantOrgId: vi.fn(async () => "org-1"),
  }));
  vi.doMock("@/lib/db", () => ({ query, queryOne, transaction }));
  vi.doMock("@/lib/domain/reply-outcome", async (original) => ({
    ...(await original<typeof import("@/lib/domain/reply-outcome")>()),
    applyOutcomeToSolicitation: applyOutcome,
  }));
  vi.doMock("@/lib/domain/quote-fields", () => ({ proposeRow }));
  vi.doMock("@/lib/pricing-rows", () => ({ saveProposedRow }));
  vi.doMock("@/lib/domain/decline-closeout", () => ({
    closeOutDeclinedSub: closeOut,
  }));
  vi.doMock("@/lib/domain/advance-stage", () => ({
    advanceIfQuotesComplete,
    closeIfSubsExhausted,
  }));
  vi.doMock("@/lib/queue", () => ({ enqueue }));
  vi.doMock("@/lib/logger", () => ({ logAgent }));

  return import("@/app/api/replies/[id]/review/route");
}

function request(outcome: string, trade?: string | null) {
  return new Request("http://localhost/api/replies/event-1/review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      outcome,
      ...(trade !== undefined ? { trade } : {}),
    }),
  });
}

function usableProposal(trade = "Electrical") {
  return {
    ok: true as const,
    row: {
      trade,
      scopeKey: trade.toLowerCase(),
      baseQuote: 42_000,
      taxes: null,
      freight: null,
      mobilization: null,
      bonding: null,
      pendingComponents: [],
      paymentTerms: "Net 30",
      quoteExpiresOn: null,
      availability: null,
      leadTimeDays: null,
      confidence: "confirmed",
      exclusions: [],
      alternates: [],
      missing: [],
      notes: [],
    },
  };
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("manual reply review", () => {
  it("never calls a reply quoted when no usable price can be recorded", async () => {
    const route = await load();
    proposeRow.mockReturnValue({
      ok: false,
      refusal: "no_amount",
      message: "No usable amount was found.",
    });

    const res = await route.POST(request("quoted"), {
      params: { id: "event-1" },
    });

    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/Nothing was marked quoted/);
    expect(applyOutcome).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("persists the extracted quote and the automatic-pipeline status fields", async () => {
    const route = await load();
    proposeRow.mockReturnValue(usableProposal());

    const res = await route.POST(request("quoted"), {
      params: { id: "event-1" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      quoteSaved: true,
      quoteSkippedExisting: false,
      trade: "Electrical",
      emailSent: false,
    });
    expect(proposeRow).toHaveBeenCalledWith(
      expect.objectContaining({ isQuote: true, quoteAmount: 42_000 }),
      expect.objectContaining({
        trade: "Electrical",
        pairedTrades: ["Electrical"],
      }),
    );
    expect(saveProposedRow).toHaveBeenCalledWith(
      expect.objectContaining({ sourceQuoteId: "quote-1", onlyIfAbsent: true }),
      expect.objectContaining({ query: clientQuery }),
    );
    expect(applyOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "quoted", trade: "Electrical" }),
      expect.objectContaining({ query: clientQuery }),
    );
    expect(
      clientQuery.mock.calls.some(([sql]) =>
        /quoted_at = coalesce\(os\.quoted_at/.test(String(sql)),
      ),
    ).toBe(true);
    const finalCall = clientQuery.mock.calls.find(([sql]) =>
      /set reviewed_at = now\(\), needs_review = false/.test(String(sql)),
    );
    expect(finalCall?.[1]).toEqual(["event-1", "quoted", "Electrical"]);
  });

  it("returns active trade choices and keeps an ambiguous review open", async () => {
    const route = await load({
      pairs: [{ trade: "Electrical" }, { trade: "Controls" }],
    });

    const res = await route.POST(request("interested"), {
      params: { id: "event-1" },
    });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toMatchObject({
      code: "trade_required",
      candidateTrades: ["Electrical", "Controls"],
    });
    expect(applyOutcome).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("applies and records the trade an operator selects", async () => {
    const route = await load({
      pairs: [{ trade: "Electrical" }, { trade: "Controls" }],
    });

    const res = await route.POST(request("interested", "Controls"), {
      params: { id: "event-1" },
    });

    expect(res.status).toBe(200);
    expect(applyOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "interested", trade: "Controls" }),
      expect.objectContaining({ query: clientQuery }),
    );
    const finalCall = clientQuery.mock.calls.find(([sql]) =>
      /set reviewed_at = now\(\), needs_review = false/.test(String(sql)),
    );
    expect(finalCall?.[1]?.[2]).toBe("Controls");
  });

  it("blocks a removed pairing before claiming or changing the review", async () => {
    const event = { ...defaultEvent, trade: "Electrical" };
    const route = await load({ event, pairs: [{ trade: "Controls" }] });

    const res = await route.POST(request("interested"), {
      params: { id: "event-1" },
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "pairing_removed" });
    const pairSql = String(
      query.mock.calls.find(([sql]) =>
        /select distinct os\.trade/.test(String(sql)),
      )?.[0],
    );
    expect(pairSql).toMatch(/os\.removed_at is null/);
    expect(pairSql).toMatch(/join opportunities o/);
    expect(pairSql).toMatch(/join subcontractors s/);
    expect(applyOutcome).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rechecks and locks the pairing before writing so a concurrent removal rolls back", async () => {
    const route = await load({ lockedPair: false });

    const res = await route.POST(request("interested"), {
      params: { id: "event-1" },
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "pairing_removed" });
    expect(applyOutcome).not.toHaveBeenCalled();
    expect(
      clientQuery.mock.calls.some(([sql]) =>
        /set reviewed_at = now\(\)/.test(String(sql)),
      ),
    ).toBe(false);
  });

  it("validates event, opportunity, and subcontractor ownership together", async () => {
    const route = await load({ event: null });

    const res = await route.POST(request("interested"), {
      params: { id: "event-1" },
    });

    expect(res.status).toBe(404);
    const lookupSql = String(queryOne.mock.calls[0]?.[0]);
    expect(lookupSql).toMatch(/join subcontractors s/);
    expect(lookupSql).toMatch(/s\.org_id = \$2/);
    expect(lookupSql).toMatch(/left join opportunities o/);
    expect(lookupSql).toMatch(/o\.org_id = \$2/);
    expect(applyOutcome).not.toHaveBeenCalled();
  });

  it("guards an already-reviewed row and a concurrent duplicate claim", async () => {
    const reviewedRoute = await load({
      event: { ...defaultEvent, reviewed_at: new Date("2026-08-02T12:00:00Z") },
    });
    const reviewed = await reviewedRoute.POST(request("interested"), {
      params: { id: "event-1" },
    });
    expect(reviewed.status).toBe(409);
    expect(await reviewed.json()).toMatchObject({ code: "already_reviewed" });

    const duplicateRoute = await load({ claim: false });
    const duplicate = await duplicateRoute.POST(request("interested"), {
      params: { id: "event-1" },
    });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ code: "already_reviewed" });
    expect(applyOutcome).not.toHaveBeenCalled();
  });

  it("closes a reviewed decline without sending an email", async () => {
    const route = await load();

    const res = await route.POST(request("declined"), {
      params: { id: "event-1" },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, emailSent: false });
    expect(body.message).toMatch(/No email was sent/);
    expect(closeOut).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        opportunityId: "opp-1",
        subcontractorId: "sub-1",
        trade: "Electrical",
        sendThankYou: false,
      }),
      expect.objectContaining({
        client: expect.objectContaining({ query: clientQuery }),
        deferActivityLog: true,
      }),
    );
    expect(applyOutcome).not.toHaveBeenCalled();
  });

  it("keeps every core quote write on the transaction client and stops before follow-ups when finalization fails", async () => {
    const route = await load({ finalize: false });
    proposeRow.mockReturnValue(usableProposal());

    const res = await route.POST(request("quoted"), {
      params: { id: "event-1" },
    });

    expect(res.status).toBe(500);
    expect(saveProposedRow).toHaveBeenCalledWith(
      expect.objectContaining({ sourceQuoteId: "quote-1" }),
      expect.objectContaining({ query: clientQuery }),
    );
    expect(applyOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "quoted" }),
      expect.objectContaining({ query: clientQuery }),
    );
    const globalWrites = query.mock.calls.filter(([sql]) =>
      /^\s*(insert|update|delete)\b/i.test(String(sql)),
    );
    expect(globalWrites).toEqual([]);
    expect(logAgent).not.toHaveBeenCalled();
    expect(advanceIfQuotesComplete).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("keeps the review open and rolls the quote back when structured pricing is no longer editable", async () => {
    const route = await load();
    proposeRow.mockReturnValue(usableProposal());
    saveProposedRow.mockResolvedValue("not_editable");

    const res = await route.POST(request("quoted"), {
      params: { id: "event-1" },
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "pricing_not_editable" });
    expect(
      clientQuery.mock.calls.some(([sql]) =>
        /set reviewed_at = now\(\)/.test(String(sql)),
      ),
    ).toBe(false);
    expect(logAgent).not.toHaveBeenCalled();
    expect(advanceIfQuotesComplete).not.toHaveBeenCalled();
  });

  it("queues partial-scope replacement work only after commit and surfaces a refusal", async () => {
    const route = await load();
    applyOutcome.mockResolvedValue({
      applied: true,
      refused: null,
      candidateTrades: [],
      enqueue: {
        agent: "sub-finder",
        payload: {
          opportunityId: "opp-1",
          trade: "Electrical",
          trigger: "partial_scope",
        },
        opts: {
          singletonKey: "resource:opp-1:Electrical",
          singletonSeconds: 3600,
        },
      },
    });
    enqueue.mockResolvedValue(null);

    const res = await route.POST(request("partial_scope"), {
      params: { id: "event-1" },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      followUpRequired: true,
      emailSent: false,
    });
    expect(body.warnings).toContain(
      "The partial-scope reply was saved, but replacement subcontractor work was not queued.",
    );
    const finalizeIndex = clientQuery.mock.calls.findIndex(([sql]) =>
      /set reviewed_at = now\(\)/.test(String(sql)),
    );
    expect(finalizeIndex).toBeGreaterThan(-1);
    expect(enqueue).toHaveBeenCalledWith(
      "sub-finder",
      expect.objectContaining({ opportunityId: "opp-1", trade: "Electrical" }),
      expect.objectContaining({ singletonKey: "resource:opp-1:Electrical" }),
    );
  });
});
