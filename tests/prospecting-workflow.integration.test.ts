/**
 * End-to-end workflow validation for a MULTI-TRADE solicitation.
 *
 * This does not test pure helpers in isolation (those have their own suites);
 * it seeds a real opportunity that needs two trades and walks the actual
 * state machine — outreach pairings, per-trade reply outcomes, the advance
 * gate, and the exhaustion escalation — against a real database, asserting the
 * resulting rows and stage are what the workflow intends.
 *
 * The behaviors under test are the ones a bid depends on:
 *   - a trade is not "covered" until a real quote exists for THAT trade
 *   - a reply outcome lands on one trade line, never the whole pairing set
 *   - the opportunity advances to bid building ONLY when every trade is priced
 *   - the structural dedupe (opportunity_subs unique) prevents double outreach
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("multi-trade prospecting workflow (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let assessQuoteCompleteness: typeof import("../lib/domain/advance-stage").assessQuoteCompleteness;
  let advanceIfQuotesComplete: typeof import("../lib/domain/advance-stage").advanceIfQuotesComplete;
  let closeIfSubsExhausted: typeof import("../lib/domain/advance-stage").closeIfSubsExhausted;
  let applyOutcomeToSolicitation: typeof import("../lib/domain/reply-outcome").applyOutcomeToSolicitation;

  const org = { id: "" };
  const opp = { id: "" };
  const elecSub = { id: "" };
  const plumbSub1 = { id: "" };
  const plumbSub2 = { id: "" };

  async function pair(subId: string, trade: string, state = "sent") {
    await query(
      `insert into opportunity_subs (opportunity_id, subcontractor_id, trade, outreach_state, verified)
       values ($1,$2,$3,$4,true)`,
      [opp.id, subId, trade, state]
    );
  }
  async function stateOf(subId: string, trade: string) {
    const r = await queryOne<{ outreach_state: string }>(
      `select outreach_state from opportunity_subs where opportunity_id=$1 and subcontractor_id=$2 and trade=$3`,
      [opp.id, subId, trade]
    );
    return r?.outreach_state;
  }
  async function stageOf() {
    const r = await queryOne<{ stage: string; status: string }>(
      `select stage, status from opportunities where id=$1`, [opp.id]
    );
    return r;
  }
  async function quote(subId: string, trade: string, amount: number) {
    await query(
      `insert into quotes (org_id, opportunity_id, subcontractor_id, trade, quote_amount)
       values ($1,$2,$3,$4,$5)`,
      [org.id, opp.id, subId, trade, amount]
    );
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({ assessQuoteCompleteness, advanceIfQuotesComplete, closeIfSubsExhausted } = await import(
      "../lib/domain/advance-stage"
    ));
    ({ applyOutcomeToSolicitation } = await import("../lib/domain/reply-outcome"));

    const o = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
      [`wf-${randomUUID()}`]
    );
    org.id = o!.id;
    const op = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, stage, status, location_state)
       values ($1,'test','Two-trade job','quote_entry','open','CA') returning id`,
      [org.id]
    );
    opp.id = op!.id;
    for (const [holder, name, trade] of [
      [elecSub, "Elec Co", "electrical"],
      [plumbSub1, "Plumb One", "plumbing"],
      [plumbSub2, "Plumb Two", "plumbing"],
    ] as const) {
      const s = await queryOne<{ id: string }>(
        `insert into subcontractors (org_id, company_name, trade_categories, state, email, email_verified)
         values ($1,$2,$3,'CA',$4,true) returning id`,
        [org.id, name, [trade], `${name.replace(/\s/g, "").toLowerCase()}@x.invalid`]
      );
      (holder as { id: string }).id = s!.id;
    }
    await pair(elecSub.id, "electrical");
    await pair(plumbSub1.id, "plumbing");
    await pair(plumbSub2.id, "plumbing");
  });

  afterAll(async () => {
    if (!org.id) return;
    await query(`delete from quotes where org_id=$1`, [org.id]);
    await query(`delete from opportunity_subs where opportunity_id=$1`, [opp.id]);
    await query(`delete from agent_logs where org_id=$1`, [org.id]);
    await query(`delete from opportunities where org_id=$1`, [org.id]);
    await query(`delete from subcontractors where org_id=$1`, [org.id]);
    await query(`delete from organizations where id=$1`, [org.id]);
  });

  it("the structural dedupe blocks a second identical pairing", async () => {
    await expect(pair(elecSub.id, "electrical")).rejects.toBeTruthy();
  });

  it("holds while any trade is unpriced", async () => {
    const a = await assessQuoteCompleteness(opp.id);
    expect(a.canAdvance).toBe(false);
    // Neither trade has a quote yet.
    expect(a.trades.every((t) => !t.covered)).toBe(true);
  });

  it("a quote reply covers only its own trade", async () => {
    await quote(elecSub.id, "electrical", 50000);
    await applyOutcomeToSolicitation({
      opportunityId: opp.id, subcontractorId: elecSub.id, trade: "electrical", outcome: "quoted",
    });
    expect(await stateOf(elecSub.id, "electrical")).toBe("quoted");
    // The plumbing lines are untouched.
    expect(await stateOf(plumbSub1.id, "plumbing")).toBe("sent");
    const a = await assessQuoteCompleteness(opp.id);
    const elec = a.trades.find((t) => t.trade === "electrical");
    const plumb = a.trades.find((t) => t.trade === "plumbing");
    expect(elec?.covered).toBe(true);
    expect(plumb?.covered).toBe(false);
    expect(a.canAdvance).toBe(false); // plumbing still open
  });

  it("a decline lands on one sub only and does not exhaust a trade that has another sub", async () => {
    await applyOutcomeToSolicitation({
      opportunityId: opp.id, subcontractorId: plumbSub1.id, trade: "plumbing", outcome: "declined",
    });
    expect(await stateOf(plumbSub1.id, "plumbing")).toBe("declined");
    expect(await stateOf(plumbSub2.id, "plumbing")).toBe("sent"); // still live
    // Electrical covered + plumbing still has a live sub → not exhausted, no close.
    const ex = await closeIfSubsExhausted(opp.id);
    expect(ex.action).toBe("none");
    expect((await stageOf())?.status).toBe("open");
  });

  it("does not advance until the second trade is actually priced", async () => {
    const a = await assessQuoteCompleteness(opp.id);
    expect(a.canAdvance).toBe(false);
    const res = await advanceIfQuotesComplete(opp.id);
    expect(res.advanced).toBe(false);
    expect((await stageOf())?.stage).toBe("quote_entry");
  });

  it("advances to bid building once every trade is priced, and enqueues the bid builder", async () => {
    await quote(plumbSub2.id, "plumbing", 30000);
    await applyOutcomeToSolicitation({
      opportunityId: opp.id, subcontractorId: plumbSub2.id, trade: "plumbing", outcome: "quoted",
    });
    const res = await advanceIfQuotesComplete(opp.id);
    expect(res.advanced).toBe(true);
    expect(res.enqueue?.agent).toBe("bid-builder");
    expect((await stageOf())?.stage).toBe("bid_building");
  });

  it("will not advance a record twice", async () => {
    const res = await advanceIfQuotesComplete(opp.id);
    expect(res.advanced).toBe(false); // already past quote_entry
  });
});


d("exhaustion escalation closes a dead opportunity with reasoning (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let closeIfSubsExhausted: typeof import("../lib/domain/advance-stage").closeIfSubsExhausted;
  let applyOutcomeToSolicitation: typeof import("../lib/domain/reply-outcome").applyOutcomeToSolicitation;

  const org = { id: "" };
  const opp = { id: "" };
  const sub = { id: "" };

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({ closeIfSubsExhausted } = await import("../lib/domain/advance-stage"));
    ({ applyOutcomeToSolicitation } = await import("../lib/domain/reply-outcome"));
    const o = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
      [`ex-${randomUUID()}`]
    );
    org.id = o!.id;
    const op = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, stage, status, location_state)
       values ($1,'test','Dead-end job','quote_entry','open','CA') returning id`,
      [org.id]
    );
    opp.id = op!.id;
    const s = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, trade_categories, state, email, email_verified)
       values ($1,'Only Sub',$2,'CA','only@x.invalid',true) returning id`,
      [org.id, ["electrical"]]
    );
    sub.id = s!.id;
    await query(
      `insert into opportunity_subs (opportunity_id, subcontractor_id, trade, outreach_state, verified)
       values ($1,$2,'electrical','sent',true)`,
      [opp.id, sub.id]
    );
  });

  afterAll(async () => {
    if (!org.id) return;
    await query(`delete from opportunity_subs where opportunity_id=$1`, [opp.id]);
    await query(`delete from agent_logs where org_id=$1`, [org.id]);
    await query(`delete from opportunities where org_id=$1`, [org.id]);
    await query(`delete from subcontractors where org_id=$1`, [org.id]);
    await query(`delete from organizations where id=$1`, [org.id]);
  });

  it("re-sources once when the only sub declines, then closes with reasoning", async () => {
    // The only sub for the only trade declines.
    await applyOutcomeToSolicitation({
      opportunityId: opp.id, subcontractorId: sub.id, trade: "electrical", outcome: "declined",
    });

    // First pass: everyone is out, so the platform tries one more search.
    const first = await closeIfSubsExhausted(opp.id);
    expect(first.action).toBe("resourced");
    expect(first.enqueue?.agent).toBe("sub-finder");
    // Still open while the retry runs.
    const mid = await queryOne<{ status: string }>(`select status from opportunities where id=$1`, [opp.id]);
    expect(mid?.status).toBe("open");

    // Second pass (retry produced nothing new, sub still declined): close it.
    const second = await closeIfSubsExhausted(opp.id);
    expect(second.action).toBe("closed");
    const closed = await queryOne<{ status: string; stage: string; risk_flags: string[] | null }>(
      `select status, stage, risk_flags from opportunities where id=$1`, [opp.id]
    );
    expect(closed?.status).toBe("archived");
    expect(closed?.risk_flags ?? []).toContain("no_viable_subs");

    // The reasoning is written to the audit log for the operator to read.
    const log = await queryOne<{ message: string }>(
      `select message from agent_logs where opportunity_id=$1 and action='closed-no-subs' order by created_at desc limit 1`,
      [opp.id]
    );
    expect(log?.message).toMatch(/no subcontractor can perform/i);
  });
});
