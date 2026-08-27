/**
 * The funnel and its drill-downs, against a real database.
 *
 * These are counts an operator uses to decide where to spend next month, and
 * they are computed in SQL that TypeScript cannot check. A dimension whose
 * join is wrong does not throw: it returns rows, with the wrong numbers in
 * them, and a wrong number is worse than an error because nobody goes looking.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { BREAKDOWN_OPTIONS, buildFunnel } from "../lib/domain/funnel";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("funnel and breakdowns (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let data: typeof import("../lib/data");
  let runWithOrg: typeof import("../lib/tenant-context").runWithOrg;

  const tag = randomUUID();
  let orgId = "";
  let otherOrgId = "";
  let userId = "";
  /** Sourced two trades, emailed, replied, quoted, bid, submitted, won. */
  let fullId = "";
  /** Emailed, no reply, no quote. The case the ninth step exists to separate. */
  let silentId = "";
  /** A quote arrived with no inbound message logged. */
  let quoteOnlyId = "";

  async function mkOpp(org: string, title: string, extra: Record<string, unknown> = {}) {
    const row = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, stage, status, score, tier,
                                  agency, naics_code, location_state, set_aside_type, assigned_to)
       values ($1,'test',$2,$3,'open',$4,$5,$6,$7,$8,$9,$10) returning id`,
      [
        org, title,
        (extra.stage as string) ?? "monitoring",
        (extra.score as number | null) ?? null,
        (extra.tier as string | null) ?? null,
        (extra.agency as string | null) ?? null,
        (extra.naics as string | null) ?? null,
        (extra.state as string | null) ?? null,
        (extra.setAside as string | null) ?? null,
        (extra.assignedTo as string | null) ?? null,
      ]
    );
    return row!.id;
  }

  async function mkSub(org: string, name: string) {
    return (await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, phone) values ($1,$2,'555-0100') returning id`,
      [org, name]
    ))!.id;
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    data = await import("../lib/data");
    ({ runWithOrg } = await import("../lib/tenant-context"));

    const mkOrg = async (n: string) =>
      (await queryOne<{ id: string }>(
        `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
        [`funnel-${n}-${tag}`]
      ))!.id;
    orgId = await mkOrg("a");
    otherOrgId = await mkOrg("b");

    userId = (await queryOne<{ id: string }>(
      `insert into users (email, name, password_hash) values ($1,'Dana Owner','x') returning id`,
      [`funnel-${tag}@example.test`]
    ))!.id;
    await query(
      `insert into organization_members (org_id, user_id, role) values ($1,$2,'admin')
       on conflict do nothing`,
      [orgId, userId]
    );

    fullId = await mkOpp(orgId, `full ${tag}`, {
      stage: "won", score: 88, tier: "pursue", agency: "GSA",
      naics: "238160", state: "TX", setAside: "SDVOSB", assignedTo: userId,
    });
    silentId = await mkOpp(orgId, `silent ${tag}`, {
      stage: "outreach", score: 71, tier: "pursue", agency: "GSA",
      naics: "238160", state: "TX",
    });
    quoteOnlyId = await mkOpp(orgId, `quote-only ${tag}`, {
      stage: "quote_entry", score: 65, tier: "pursue", agency: "USACE",
    });
    // Another tenant's opportunity, identical in every visible way.
    await mkOpp(otherOrgId, `theirs ${tag}`, { stage: "won", score: 90, tier: "pursue", agency: "GSA" });

    const roofer = await mkSub(orgId, `Roofer ${tag}`);
    const hvac = await mkSub(orgId, `HVAC ${tag}`);
    const second = await mkSub(orgId, `Roofer Two ${tag}`);

    // Two trades on the full opportunity, and two subcontractors on one of
    // them: the case that double-counts if the trade join forgets `distinct`.
    for (const [sub, trade] of [
      [roofer, "Roofing"], [second, "Roofing"], [hvac, "HVAC"],
    ] as const) {
      await query(
        `insert into opportunity_subs (opportunity_id, subcontractor_id, trade, outreach_state)
         values ($1,$2,$3,'contacted')`,
        [fullId, sub, trade]
      );
    }
    await query(
      `insert into opportunity_subs (opportunity_id, subcontractor_id, trade, outreach_state)
       values ($1,$2,'Roofing','contacted')`,
      [silentId, roofer]
    );

    const comm = async (opp: string, direction: string) =>
      query(
        `insert into communications (org_id, subcontractor_id, opportunity_id, channel,
                                     direction, subject, body)
         values ($1,$2,$3,'email',$4,'q','q')`,
        [orgId, roofer, opp, direction]
      );
    await comm(fullId, "outbound");
    await comm(fullId, "inbound");
    await comm(silentId, "outbound"); // sent, never answered
    await comm(quoteOnlyId, "outbound");

    const quote = async (opp: string) =>
      query(
        `insert into quotes (org_id, opportunity_id, subcontractor_id, trade, quote_amount)
         values ($1,$2,$3,'Roofing',1000)`,
        [orgId, opp, roofer]
      );
    await quote(fullId);
    await quote(quoteOnlyId); // priced without a logged inbound message

    await query(
      /*
       * The submission evidence columns are not optional: a bid carrying a
       * submitted_at with no method, destination and timezone is refused by
       * bids_submitted_evidence_ck, which is exactly the point of it.
       */
      `insert into bids (org_id, opportunity_id, bid_amount, submitted_at, outcome,
                         submission_method, submission_destination, sent_timezone)
       values ($1,$2,50000, now(), 'won', 'email', 'ko@example.invalid', 'America/Denver')`,
      [orgId, fullId]
    );
  });

  afterAll(async () => {
    for (const org of [orgId, otherOrgId]) {
      if (!org) continue;
      await query(`delete from quotes where org_id = $1`, [org]).catch(() => {});
      await query(`delete from communications where org_id = $1`, [org]).catch(() => {});
      await query(`delete from bids where org_id = $1`, [org]).catch(() => {});
      await query(
        `delete from opportunity_subs where opportunity_id in
           (select id from opportunities where org_id = $1)`,
        [org]
      ).catch(() => {});
      await query(`delete from opportunities where org_id = $1`, [org]).catch(() => {});
      await query(`delete from subcontractors where org_id = $1`, [org]).catch(() => {});
      await query(`delete from organization_members where org_id = $1`, [org]).catch(() => {});
      await query(`delete from organizations where id = $1`, [org]).catch(() => {});
    }
    if (userId) await query(`delete from users where id = $1`, [userId]).catch(() => {});
  });

  it("separates who was contacted from who wrote back", async () => {
    /*
     * The whole reason the ninth step exists. Three opportunities were
     * emailed; one was answered, one produced a quote with no logged reply,
     * and one went silent. Without this step the page reports "3 contacted, 2
     * quoted" and cannot say that one of the three was simply ignored.
     */
    const c = await runWithOrg(orgId, () => data.funnelCounts(null));
    expect(c.reached.subs_contacted).toBe(3);
    expect(c.reached.replies_received).toBe(2);
    expect(c.reached.quotes_received).toBe(2);
    expect(c.pendingBefore.replies_received).toBe(1); // the silent one, still open
  });

  it("counts a quote as a reply, so the funnel never widens", async () => {
    // A quote logged without an inbound message is still the subcontractor
    // answering. Ranking it below the replies step would print more quotes
    // than replies, which reads as a bug whichever way it is explained.
    const c = await runWithOrg(orgId, () => data.funnelCounts(null));
    const steps = buildFunnel(c);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].count, `${steps[i].label} > ${steps[i - 1].label}`)
        .toBeLessThanOrEqual(steps[i - 1].count);
    }
  });

  it("never counts another organization's opportunities", async () => {
    const c = await runWithOrg(orgId, () => data.funnelCounts(null));
    expect(c.reached.found).toBe(3);
    const theirs = await runWithOrg(otherOrgId, () => data.funnelCounts(null));
    expect(theirs.reached.found).toBe(1);
    expect(theirs.reached.subs_contacted).toBe(0);
  });

  it("runs every drill-down dimension against the real schema", async () => {
    // A dimension whose join is wrong throws here rather than at 9am on the
    // page. Every option in the picker is exercised, so adding one to the
    // list without a query is caught.
    for (const opt of BREAKDOWN_OPTIONS) {
      const rows = await runWithOrg(orgId, () => data.funnelBreakdown(opt.key, null));
      expect(Array.isArray(rows), `${opt.key} returned nothing usable`).toBe(true);
    }
  });

  it("counts an opportunity once per trade, not once per subcontractor", async () => {
    /*
     * Three opportunity_subs rows on one opportunity across two trades, two of
     * them the same trade. Roofing must read 2 opportunities, not 3, and HVAC
     * 1. Losing the distinct would put the same bid in the win rate twice.
     */
    const rows = await runWithOrg(orgId, () => data.funnelBreakdown("trade", null));
    const roofing = rows.find((r) => r.key === "Roofing");
    const hvac = rows.find((r) => r.key === "HVAC");
    expect(roofing?.found).toBe(2);
    expect(roofing?.won).toBe(1);
    expect(hvac?.found).toBe(1);
  });

  it("gives unassigned work a row of its own", async () => {
    // Folding it in with a named owner would hide the one thing this
    // dimension is asked: what nobody has picked up.
    const rows = await runWithOrg(orgId, () => data.funnelBreakdown("owner", null));
    expect(rows.find((r) => r.key === "Dana Owner")?.found).toBe(1);
    expect(rows.find((r) => r.key === "Unassigned")?.found).toBe(2);
  });

  it("says how a dimension counts when it is not one row per opportunity", () => {
    const trade = BREAKDOWN_OPTIONS.find((o) => o.key === "trade");
    expect(trade?.note).toBeTruthy();
    // Every column dimension totals to the account, so it needs no caveat.
    expect(BREAKDOWN_OPTIONS.find((o) => o.key === "agency")?.note).toBeUndefined();
  });
});
