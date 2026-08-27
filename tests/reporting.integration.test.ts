/**
 * The reported figures, against a real schema.
 *
 * Every one of these is SQL, which TypeScript cannot check, and they are
 * numbers an operator plans a month around. A query with a wrong join does not
 * throw; it returns a plausible figure, and a plausible wrong figure is worse
 * than an error because nobody goes looking for it.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("reported metrics (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let reporting: typeof import("../lib/reporting");
  let runWithOrg: typeof import("../lib/tenant-context").runWithOrg;

  const tag = randomUUID();
  let orgId = "";
  let otherOrgId = "";
  let subId = "";
  let missedId = "";
  let onTimeId = "";
  let lateId = "";

  const value = (m: import("../lib/domain/report-metrics").Metric[], key: string) =>
    m.find((x) => x.key === key);

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    reporting = await import("../lib/reporting");
    ({ runWithOrg } = await import("../lib/tenant-context"));

    const mkOrg = async (s: string) =>
      (await queryOne<{ id: string }>(
        `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
        [`report-${s}-${tag}`]
      ))!.id;
    orgId = await mkOrg("a");
    otherOrgId = await mkOrg("b");

    subId = (await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, phone) values ($1,$2,'555-0100') returning id`,
      [orgId, `Report Sub ${tag}`]
    ))!.id;

    const mkOpp = async (title: string, sql: Record<string, unknown>) =>
      (await queryOne<{ id: string }>(
        `insert into opportunities (org_id, source, title, stage, status, tier, deadline,
                                    value_estimated, value_estimated_source, score,
                                    score_breakdown, pursuit_changed_at, human_action_required)
         values ($1,'test',$2,$3,'open','pursue',$4,$5,$6,$7,$8::jsonb,$9,$10) returning id`,
        [
          orgId, title,
          (sql.stage as string) ?? "bid_building",
          (sql.deadline as string | null) ?? null,
          (sql.value as number | null) ?? null,
          (sql.valueSource as string | null) ?? null,
          (sql.score as number | null) ?? null,
          (sql.breakdown as string | null) ?? null,
          (sql.pursuitAt as string | null) ?? null,
          (sql.flagged as boolean) ?? false,
        ]
      ))!.id;

    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();

    missedId = await mkOpp(`missed ${tag}`, { deadline: yesterday });
    onTimeId = await mkOpp(`on time ${tag}`, { deadline: yesterday });
    lateId = await mkOpp(`late ${tag}`, { deadline: twoDaysAgo });
    // Published value, estimated value, and no value at all.
    await mkOpp(`published ${tag}`, {
      value: 500_000, valueSource: "sam", score: 80,
      breakdown: JSON.stringify({ data_confidence: { level: "high", percent: 91 } }),
      /*
       * Decided an hour ago, which is after the row was created a moment ago.
       * A decision stamped before its own record is nonsense and the query
       * refuses it, so the fixture has to be coherent too.
       */
      pursuitAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    await mkOpp(`estimated ${tag}`, {
      value: 300_000, valueSource: "analysis", score: 60,
      breakdown: JSON.stringify({ data_confidence: { level: "low", percent: 30 } }),
    });
    // Scored before confidence existed: a real record shape, and the reason
    // the coverage metric exists.
    await mkOpp(`unvalued ${tag}`, { score: 55, flagged: true });

    const bid = async (opp: string, submittedAt: string) =>
      query(
        `insert into bids (org_id, opportunity_id, bid_amount, submitted_at, outcome,
                           submission_method, submission_destination, sent_timezone)
         values ($1,$2,10000,$3,'won','email','ko@example.invalid','America/Denver')`,
        [orgId, opp, submittedAt]
      );
    await bid(onTimeId, new Date(Date.now() - 2 * 86_400_000).toISOString());
    await bid(lateId, new Date().toISOString()); // after its deadline

    // Outreach: one confirmed delivered and replied, one bounced, one quiet.
    const comm = async (state: string | null, replied: boolean) =>
      query(
        `insert into communications (org_id, subcontractor_id, opportunity_id, channel,
                                     direction, subject, body, delivery_state, replied_at)
         values ($1,$2,$3,'email','outbound','q','q',$4,$5)`,
        [orgId, subId, missedId, state, replied ? new Date().toISOString() : null]
      );
    await comm("delivered", true);
    await comm("bounced", false);
    await comm("sent", false);

    // Two trades sourced on one opportunity, one of them priced.
    for (const trade of ["Roofing", "HVAC"]) {
      await query(
        `insert into opportunity_subs (opportunity_id, subcontractor_id, trade, outreach_state)
         values ($1,$2,$3,'contacted')`,
        [missedId, subId, trade]
      );
    }
    await query(
      `insert into quotes (org_id, opportunity_id, subcontractor_id, trade, quote_amount)
       values ($1,$2,$3,'Roofing',1000)`,
      [orgId, missedId, subId]
    );

    // Automation: a failure then a success on the same record, plus a clean run.
    const run = async (agent: string, status: string, opp: string | null, ago: number) =>
      query(
        `insert into job_runs (org_id, agent, trigger, status, started_at, finished_at)
         values ($1,$2,'cron',$3, now() - ($4 || ' minutes')::interval, now())`,
        [orgId, agent, status, String(ago)]
      ).then(() =>
        opp
          ? query(
              `update job_runs set opportunity_id = $2
                where id = (select id from job_runs where org_id = $1 and agent = $3
                             order by started_at desc limit 1)`,
              [orgId, opp, agent]
            )
          : null
      );
    await run("report-probe", "error", missedId, 30);
    await run("report-probe", "ok", missedId, 10);
    await run("report-other", "ok", null, 5);
  });

  afterAll(async () => {
    for (const org of [orgId, otherOrgId]) {
      if (!org) continue;
      await query(`delete from job_runs where org_id = $1`, [org]).catch(() => {});
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
      await query(`delete from organizations where id = $1`, [org]).catch(() => {});
    }
  });

  it("counts a deadline that passed with no bid as missed", async () => {
    const m = await runWithOrg(orgId, () => reporting.deadlineMetrics(null, null));
    expect(value(m, "deadline_missed")?.value).toBe(1);
  });

  it("does not let a bid filed after the closing date count as on time", async () => {
    /*
     * A submission stamped after the deadline is a miss with a receipt.
     * Counting it as a save is how a chronically late process looks fine.
     */
    const m = await runWithOrg(orgId, () => reporting.deadlineMetrics(null, null));
    expect(value(m, "deadline_late")?.value).toBe(1);
    // One of three passed deadlines went in on time.
    expect(value(m, "deadline_on_time_rate")?.value).toBe(33.3);
  });

  it("measures decision time only over decisions actually taken", async () => {
    const m = await runWithOrg(orgId, () => reporting.reviewMetrics(null, null));
    const dec = value(m, "review_decision_days");
    expect(dec?.value).not.toBeNull();
    // Coverage says how much of the period the median speaks for, so a fast
    // median over one decision cannot pass for a fast process.
    expect(dec?.coverage?.have).toBe(1);
    expect((dec?.coverage?.need ?? 0) > 1).toBe(true);
  });

  it("never counts a send that merely left as proof it arrived", async () => {
    /*
     * The rest of this product refuses to claim a message was received
     * without evidence, and the report has to say the same thing or it
     * quietly contradicts the Communications page.
     */
    const m = await runWithOrg(orgId, () => reporting.subcontractorMetrics(null, null));
    // One of three sends has positive evidence; the quiet one is not counted.
    expect(value(m, "sub_confirmed_delivery_rate")?.value).toBe(33.3);
    expect(value(m, "sub_refused_rate")?.value).toBe(33.3);
    expect(value(m, "sub_response_rate")?.value).toBe(33.3);
  });

  it("counts a trade once however many subcontractors were asked", async () => {
    const m = await runWithOrg(orgId, () => reporting.tradeCoverageMetrics(null, null));
    const cov = value(m, "trade_quote_coverage");
    expect(cov?.coverage).toEqual({ have: 1, need: 2 });
    expect(cov?.value).toBe(50);
  });

  it("keeps published value apart from estimated, and never values the unknown", async () => {
    const r = await runWithOrg(orgId, () => reporting.pipelineValueReport(null, null, 50));
    expect(r.split.known).toEqual({ count: 1, total: 500_000 });
    expect(r.split.modeled).toEqual({ count: 1, total: 300_000 });
    // Everything else is open with no figure: counted, never added in as nought.
    expect(r.split.unknown.count).toBeGreaterThan(0);
    expect(r.expectedCents).toBe(400_000);
  });

  it("refuses to forecast without a measured win rate", async () => {
    const r = await runWithOrg(orgId, () => reporting.pipelineValueReport(null, null, null));
    expect(r.expectedCents).toBeNull();
    expect(value(r.metrics, "expected_pipeline_value")?.absent).toContain("no win rate");
  });

  it("counts a score with no confidence reading against coverage", async () => {
    // Records scored before confidence existed read as ordinary scores and
    // are not. Quietly excluding them would hide exactly that.
    const m = await runWithOrg(orgId, () => reporting.dataConfidenceMetrics(null, null));
    const cov = value(m, "confidence_measured_coverage");
    expect(cov?.coverage).toEqual({ have: 2, need: 3 });
    expect(value(m, "confidence_high_share")?.value).toBe(50);
  });

  it("separates a retry that worked from one that merely happened", async () => {
    const m = await runWithOrg(orgId, () => reporting.automationMetrics(null, null));
    expect(value(m, "automation_success_rate")?.value).toBe(66.7);
    // One of the three runs was a second attempt on the same record.
    expect(value(m, "automation_retry_rate")?.value).toBe(33.3);
    // And that attempt succeeded, so the one failure was recovered.
    expect(value(m, "automation_recovery_rate")?.value).toBe(100);
    expect(value(m, "manual_intervention")?.value).toBe(1);
  });

  it("reports a rate as absent rather than nought when nothing qualifies", async () => {
    // The rule the whole module is built on, proved on an account with no
    // records at all rather than argued about.
    const m = await runWithOrg(otherOrgId, () => reporting.subcontractorMetrics(null, null));
    for (const x of m) {
      expect(x.value, `${x.key} invented a value`).toBeNull();
      expect(x.absent, `${x.key} gave no reason`).toBeTruthy();
    }
  });

  it("never lets another organization's records into a figure", async () => {
    const m = await runWithOrg(otherOrgId, () => reporting.deadlineMetrics(null, null));
    expect(value(m, "deadline_missed")?.value).toBeNull();
    const a = await runWithOrg(otherOrgId, () => reporting.automationMetrics(null, null));
    expect(value(a, "automation_success_rate")?.value).toBeNull();
  });

  it("gives a pinned metric the same value as the reported one", async () => {
    /*
     * The property the shared catalog exists for. An operator who pins a
     * figure and then reads a different one further down the same page has no
     * way to tell which is right, and will reasonably conclude neither is.
     */
    const { getMetric } = await import("../lib/domain/kpi");
    const reported = await runWithOrg(orgId, () => reporting.tradeCoverageMetrics(null, null));
    const def = getMetric("trade_quote_coverage")!;
    const pinned = await runWithOrg(orgId, () =>
      reporting.pinnedMetric({ ...def, label: "My trade coverage" }, { days: 0 })
    );
    expect(pinned.value).toBe(value(reported, "trade_quote_coverage")?.value);
    expect(pinned.coverage).toEqual(value(reported, "trade_quote_coverage")?.coverage);
    // The operator's own label survives; they named it for a reason.
    expect(pinned.label).toBe("My trade coverage");
    // And the real inclusion rule arrives with it, not the picker placeholder.
    expect(pinned.provenance.inclusion).toBe(
      value(reported, "trade_quote_coverage")?.provenance.inclusion
    );
  });

  it("gives a pinned older metric a reason rather than a dash", async () => {
    const { getMetric } = await import("../lib/domain/kpi");
    const def = getMetric("avg_margin")!;
    const pinned = await runWithOrg(otherOrgId, () => reporting.pinnedMetric(def, {}));
    expect(pinned.value).toBeNull();
    expect(pinned.absent).toBeTruthy();
    expect(pinned.provenance.formula.length).toBeGreaterThan(10);
  });

  it("makes every metric say where it came from", async () => {
    /*
     * Provenance is part of the type so a metric cannot be added without it,
     * but a writer can still pass an empty string. The first time one of
     * these disagrees with somebody's spreadsheet, this is what settles it.
     */
    const all = [
      ...(await runWithOrg(orgId, () => reporting.deadlineMetrics(null, null))),
      ...(await runWithOrg(orgId, () => reporting.reviewMetrics(null, null))),
      ...(await runWithOrg(orgId, () => reporting.subcontractorMetrics(null, null))),
      ...(await runWithOrg(orgId, () => reporting.tradeCoverageMetrics(null, null))),
      ...(await runWithOrg(orgId, () => reporting.dataConfidenceMetrics(null, null))),
      ...(await runWithOrg(orgId, () => reporting.automationMetrics(null, null))),
      ...(await runWithOrg(orgId, () => reporting.pipelineValueReport(null, null, 50))).metrics,
    ];
    expect(all.length).toBeGreaterThan(10);
    for (const m of all) {
      expect(m.provenance.formula.length, `${m.key} has no formula`).toBeGreaterThan(20);
      expect(m.provenance.sources.length, `${m.key} names no source`).toBeGreaterThan(0);
      expect(m.provenance.inclusion.length, `${m.key} states no inclusion rule`).toBeGreaterThan(20);
    }
  });
});
