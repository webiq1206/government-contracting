/**
 * LEARNING LOOP, weekly cron (Mondays 09:00). Closes the feedback loop:
 *  1) Analyzes recent won/lost bids against the scoring dimensions (via Claude)
 *     and proposes new scoring weights as an INACTIVE scoring_weights version
 *     (operator approves later to activate, this agent never activates).
 *  2) Recomputes subcontractor responsiveness + reliability scores and elevates
 *     strong performers to preferred.
 *  3) Emits a weekly report (agent_logs reasoning + optional email digest).
 *
 * Requires Claude for the weight analysis (worksWithoutClaude:false).
 */
import { z } from "zod";
import { config } from "../config";
import { query, queryOne } from "../db";
import { completeJson, ClaudeNotConfiguredError } from "../ai/claude";
import { getProfileJson } from "../ai/companyProfile";
import { logAgent } from "../logger";
import { orgsToSweep, fanoutNote } from "./org-fanout";
import { systemMail } from "../integrations/system-mail";
import { listActiveOrganizations } from "../organizations";
import { LEGACY_ORG_ID, runWithOrg } from "../tenant-context";
import type { AgentDefinition } from "./types";

/** Named once, because the fan-out helper logs under it. */
const AGENT_NAME = "learning-loop";
import type { AgentResult, ScoreBreakdown } from "../types";
import { reliabilityBreakdown, isPreferred as preferred } from "../domain/reliability";

const AnalysisSchema = z.object({
  weight_adjustments: z
    .array(
      z.object({
        key: z.string(),
        current_weight: z.number(),
        proposed_weight: z.number(),
        rationale: z.string(),
      })
    )
    .default([]),
  pricing_insight: z.string().default(""),
  agency_insights: z.string().default(""),
  summary: z.string().default(""),
  supporting_data: z.record(z.string(), z.unknown()).default({}),
});

interface BidOutcomeRow {
  id: string;
  opportunity_id: string;
  bid_amount: string | number | null;
  margin_pct: string | number | null;
  outcome: string | null;
  loss_reason: string | null;
  naics_code: string | null;
  score_breakdown: ScoreBreakdown | null;
  tier: string | null;
}

export const learningLoop: AgentDefinition = {
  name: "learning-loop",
  label: "Learning Loop",
  description:
    "Weekly: proposes new (inactive) scoring weights from win/loss data, recomputes sub reliability, and emits a report.",
  cron: "0 9 * * 1",
  worksWithoutClaude: false,
  async handler(): Promise<AgentResult> {
    /**
     * One tuning pass per organization.
     *
     * Every read here ran unscoped, so the weights proposed to a customer were
     * derived from every other customer's wins, losses and sub performance,
     * and the proposal was written with no org at all, which the approval
     * screen reads by. Nothing leaked to a screen, which is exactly why it
     * would have gone unnoticed: each customer's tuning was quietly being
     * driven by strangers' outcomes.
     */
    const fanout = await orgsToSweep(AGENT_NAME);
    const orgs = fanout.orgs;

    const summaries: string[] = [];
    for (const org of orgs) {
      summaries.push(await runWithOrg(org.id, () => learnForOrg(org.id)));
    }

    const note = fanoutNote(fanout);
    return {
      ok: fanout.error == null,
      summary: note
        ? note
        : summaries.length === 1
          ? summaries[0]
          : `Learning loop across ${summaries.length} organizations. ${summaries.join(" | ")}`,
    };
  },
};

async function learnForOrg(orgId: string): Promise<string> {
  const profile = await getProfileJson();

  // --- Load recent decided bids. ---
  const outcomes = await query<BidOutcomeRow>(
    `select b.id, b.opportunity_id, b.bid_amount, b.margin_pct, b.outcome, b.loss_reason,
            o.naics_code, o.score_breakdown, o.tier
       from bids b
       join opportunities o on o.id = b.opportunity_id
      where b.org_id = $1
        and b.outcome in ('won','lost')
      order by b.updated_at desc
      limit 100`,
    [orgId]
  );

  const wins = outcomes.filter((o) => o.outcome === "won").length;
  const losses = outcomes.filter((o) => o.outcome === "lost").length;

  // --- Current active weights (baseline for proposals). ---
  // Several tenants each hold an active version, so "any active row" is
  // whichever one the planner happens to reach: the proposal would be a
  // delta against a rubric this customer has never seen.
  const activeWeights = await queryOne<{ version: number; weights: Record<string, unknown> }>(
    `select version, weights from scoring_weights
      where is_active = true and org_id = $1 limit 1`,
    [orgId]
  );
  const currentWeights: Record<string, unknown> = activeWeights?.weights ?? {};

  // --- Analyze via Claude. ---
  // Below 20 decided bids the sample is too small: weekly proposals would
  // churn and contradict each other. Wait for a meaningful sample.
  const MIN_OUTCOMES_FOR_PROPOSAL = 20;
  let analysis: z.infer<typeof AnalysisSchema> | null = null;
  let claudeSkipped = false;
  if (outcomes.length > 0 && outcomes.length < MIN_OUTCOMES_FOR_PROPOSAL) {
    await logAgent({
      agent: "learning-loop",
      action: "analyze-outcomes",
      message: `Only ${outcomes.length} decided bid(s) so far (need ${MIN_OUTCOMES_FOR_PROPOSAL}). Weight analysis starts once more wins and losses are recorded. This is normal early on.`,
    });
  }
  if (outcomes.length >= MIN_OUTCOMES_FOR_PROPOSAL) {
    const prompt = buildAnalysisPrompt(outcomes, currentWeights, profile?.scoring_rubric?.dimensions ?? []);
    try {
      const { data, usage } = await completeJson(prompt, {
        schema: AnalysisSchema,
        model: config.claude.modelSmart, // rubric-weight reasoning, worth the stronger model
        maxTokens: 2000,
      });
      analysis = data;
      await logAgent({
        agent: "learning-loop",
        action: "analyze-outcomes",
        message: `Analyzed ${outcomes.length} outcomes (${wins}W/${losses}L).`,
        claudeUsage: usage,
      });
    } catch (err) {
      if (err instanceof ClaudeNotConfiguredError) {
        claudeSkipped = true;
        await logAgent({
          agent: "learning-loop",
          action: "analyze-outcomes",
          level: "warn",
          status: "skipped",
          message: "Claude not configured, skipping weight analysis this run.",
        });
      } else {
        throw err;
      }
    }
  }

  // --- Propose a new INACTIVE scoring_weights version (never activate). ---
  let proposedVersion: number | null = null;
  if (analysis && analysis.weight_adjustments.length > 0) {
    // Versions are per organization (043 made the uniqueness per org too),
    // so a busy tenant does not push everyone else's version numbers up.
    const maxVersion = await queryOne<{ max: number }>(
      `select coalesce(max(version),0) as max from scoring_weights where org_id = $1`,
      [orgId]
    );
    proposedVersion = (maxVersion?.max ?? 0) + 1;
    const mergedWeights: Record<string, unknown> = { ...currentWeights };
    for (const adj of analysis.weight_adjustments) {
      const prev = (mergedWeights[adj.key] as Record<string, unknown>) ?? {};
      mergedWeights[adj.key] = { ...prev, weight: adj.proposed_weight };
    }
    const rationale = analysis.weight_adjustments
      .map((a) => `${a.key}: ${a.current_weight}→${a.proposed_weight} (${a.rationale})`)
      .join("; ");
    // scoring_weights is a root table, so nothing derives the org for it.
    // A proposal with no org is one the approval screen, which reads by
    // org, can never show: the customer would never get to approve it.
    await query(
      `insert into scoring_weights
         (org_id, version, weights, rationale, is_active, proposed_by, proposed_at, supporting_data)
       values ($5,$1,$2,$3,false,'learning-loop',now(),$4)`,
      [
        proposedVersion,
        JSON.stringify(mergedWeights),
        rationale,
        JSON.stringify(analysis.supporting_data ?? {}),
        orgId,
      ]
    );
    await logAgent({
      agent: "learning-loop",
      action: "propose-weights",
      message: `Proposed scoring_weights v${proposedVersion} (inactive; awaiting approval).`,
      reasoning: rationale,
    });
  }

  // --- Recompute sub reliability + responsiveness. ---
  const subUpdates = await recomputeSubScores(orgId);

  // --- Weekly report. ---
  const reportLines: string[] = [];
  reportLines.push(`Learning Loop weekly report`);
  reportLines.push(
    `Outcomes analyzed: ${outcomes.length} (${wins} won, ${losses} lost).`
  );
  if (proposedVersion) {
    reportLines.push(`Proposed scoring weights v${proposedVersion} (inactive, approve to apply).`);
  } else if (claudeSkipped) {
    reportLines.push(`Weight analysis skipped (Claude not configured).`);
  } else {
    reportLines.push(`No scoring-weight changes proposed this week.`);
  }
  if (analysis?.pricing_insight) reportLines.push(`Pricing: ${analysis.pricing_insight}`);
  if (analysis?.agency_insights) reportLines.push(`Agencies: ${analysis.agency_insights}`);
  reportLines.push(
    `Sub scores updated: ${subUpdates.updated}; promoted to preferred: ${subUpdates.promoted}.`
  );
  if (analysis?.summary) reportLines.push(analysis.summary);
  const report = reportLines.join("\n");

  await logAgent({
    agent: "learning-loop",
    action: "weekly-report",
    level: "info",
    message: "Weekly learning report generated.",
    reasoning: report,
    output: {
      wins,
      losses,
      proposedVersion,
      subUpdated: subUpdates.updated,
      subPromoted: subUpdates.promoted,
    },
  });

  // --- Optional email digest. ---
  // Same rule as the KPI digest: it goes to the platform's own address, so
  // it may only ever carry the platform's own numbers. Sent per tenant it
  // would mail each customer's win/loss record to us, once per customer.
  if (orgId === LEGACY_ORG_ID && (await systemMail.enabled())) {
    const html = `<h2>Learning Loop, Weekly Report</h2><pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(
      report
    )}</pre>`;
    await systemMail.sendDigest({
      to: config.systemMail.digestTo,
      subject: `BROST CO Learning Loop, ${wins}W/${losses}L this cycle`,
      html,
      text: report,
    });
  }

  return `${outcomes.length} outcomes (${wins}W/${losses}L)${
    proposedVersion ? `, proposed weights v${proposedVersion}` : ""
  }; ${subUpdates.updated} subs updated, ${subUpdates.promoted} promoted`;
}

function buildAnalysisPrompt(
  outcomes: BidOutcomeRow[],
  currentWeights: Record<string, unknown>,
  dimensions: { key: string; label: string; max_points: number }[]
): string {
  const rows = outcomes.map((o) => {
    const dims = (o.score_breakdown?.dimensions ?? []).reduce<Record<string, number>>(
      (acc, d) => {
        acc[d.key] = d.points;
        return acc;
      },
      {}
    );
    return {
      outcome: o.outcome,
      score: o.score_breakdown?.total ?? null,
      tier: o.tier,
      naics: o.naics_code,
      margin_pct: o.margin_pct == null ? null : Number(o.margin_pct),
      loss_reason: o.loss_reason,
      dimension_points: dims,
    };
  });
  return [
    "You tune a 100-point opportunity-scoring rubric for a government contractor using historical win/loss data. Identify which scoring dimensions actually predict wins and propose weight adjustments. Be conservative; only propose changes supported by the data. Do not use em dashes.",
    "",
    "SCORING DIMENSIONS:",
    ...dimensions.map((d) => `- ${d.key} ("${d.label}", max ${d.max_points})`),
    "",
    "CURRENT WEIGHTS (per dimension key):",
    JSON.stringify(currentWeights),
    "",
    "DECIDED BIDS (win/loss, total score, per-dimension points, naics, margin, loss reason):",
    JSON.stringify(rows),
    "",
    "Return JSON: { weight_adjustments: [{key, current_weight, proposed_weight, rationale}], pricing_insight: string, agency_insights: string, summary: string, supporting_data: object }. Use empty arrays/strings where you have no confident recommendation.",
  ].join("\n");
}

interface SubUpdateResult {
  updated: number;
  promoted: number;
}

/**
 * Recompute responsiveness + reliability for subs that have communications or
 * quotes. Responsiveness rewards replying within 48h of outreach; reliability is
 * a simple heuristic from quote presence and blacklist status. Subs scoring
 * reliability >= 80 are elevated to preferred.
 */
async function recomputeSubScores(orgId: string): Promise<SubUpdateResult> {
  /*
   * Six dimensions rather than two, and each read from the records that
   * actually carry it.
   *
   * The lateral subqueries are there because the counts live on three
   * different tables and joining them all into one group-by multiplies the
   * rows: a firm with four emails and two performance notes would report eight
   * of each. That is the kind of arithmetic error nobody spots, because the
   * output is a plausible number.
   */
  const subs = await query<{
    id: string;
    blacklisted: boolean;
    outreach: number;
    responded_48h: number;
    responded_any: number;
    quote_count: number;
    quotes_with_deadline: number;
    quotes_on_time: number;
    quotes_scope_judged: number;
    quotes_full_scope: number;
    jobs_completed: number;
    jobs_with_issues: number;
    cancellations: number;
  }>(
    `select s.id,
            s.blacklisted,
            coalesce(comm.outreach, 0) as outreach,
            coalesce(comm.responded_48h, 0) as responded_48h,
            coalesce(comm.responded_any, 0) as responded_any,
            coalesce(q.quote_count, 0) as quote_count,
            coalesce(pair.with_deadline, 0) as quotes_with_deadline,
            coalesce(pair.on_time, 0) as quotes_on_time,
            coalesce(pair.judged, 0) as quotes_scope_judged,
            coalesce(pair.full_scope, 0) as quotes_full_scope,
            coalesce(perf.completed, 0) + coalesce(perf.issues, 0) as jobs_completed,
            coalesce(perf.issues, 0) as jobs_with_issues,
            coalesce(perf.cancelled, 0) as cancellations
       from subcontractors s
       left join lateral (
         select count(*) filter (where c.direction='outbound') as outreach,
                count(*) filter (
                  where c.replied_at is not null
                    and c.replied_at <= c.created_at + interval '48 hours'
                ) as responded_48h,
                count(*) filter (where c.replied_at is not null) as responded_any
           from communications c where c.subcontractor_id = s.id
       ) comm on true
       left join lateral (
         select count(*) as quote_count from quotes qq where qq.subcontractor_id = s.id
       ) q on true
       left join lateral (
         select
           count(*) filter (where os.quote_due_at is not null and os.quoted_at is not null)
             as with_deadline,
           count(*) filter (
             where os.quote_due_at is not null and os.quoted_at is not null
               and os.quoted_at <= os.quote_due_at
           ) as on_time,
           count(*) filter (where os.quote_full_scope is not null) as judged,
           count(*) filter (where os.quote_full_scope) as full_scope
           from opportunity_subs os
           join opportunities o on o.id = os.opportunity_id
          where os.subcontractor_id = s.id and o.org_id = $1
       ) pair on true
       left join lateral (
         select
           count(*) filter (where e.kind = 'completed') as completed,
           count(*) filter (where e.kind = 'issue') as issues,
           count(*) filter (where e.kind = 'cancelled') as cancelled
           from subcontractor_performance_events e
          where e.subcontractor_id = s.id and e.org_id = $1 and e.retracted_at is null
       ) perf on true
      where s.org_id = $1`,
    [orgId]
  );

  let updated = 0;
  let promoted = 0;
  for (const s of subs) {
    const outreach = Number(s.outreach);
    const resp48 = Number(s.responded_48h);
    const respAny = Number(s.responded_any);
    const quotes = Number(s.quote_count);

    /*
     * The arithmetic moved to lib/domain/reliability.ts, which is also what
     * the roster reads to show the breakdown behind the number. Two copies
     * would eventually disagree, and the way anyone would notice is a
     * breakdown whose parts do not add up to the score above them.
     */
    const inputs = {
      outreach,
      respondedWithin48h: resp48,
      respondedEver: respAny,
      quotes,
      quotesWithDeadline: Number(s.quotes_with_deadline),
      quotesOnTime: Number(s.quotes_on_time),
      quotesScopeJudged: Number(s.quotes_scope_judged),
      quotesFullScope: Number(s.quotes_full_scope),
      jobsCompleted: Number(s.jobs_completed),
      jobsWithIssues: Number(s.jobs_with_issues),
      cancellations: Number(s.cancellations),
      blacklisted: Boolean(s.blacklisted),
    };
    const breakdown = reliabilityBreakdown(inputs);
    const responsiveness = breakdown.responsiveness;
    const reliability = breakdown.reliability;

    const isPreferred = preferred(inputs);
    if (isPreferred) promoted++;

    /*
     * Null is written as null. A firm nothing is known about has no score, and
     * writing a placeholder into the column an operator sorts by would put a
     * stranger above a firm that walked off a job. The column is nullable and
     * the roster renders the absence in words.
     */

    // Preferred status is recomputed each run, NOT a one-way ratchet: a sub whose
    // reliability drops below 80 or that gets blacklisted MUST be demoted, or Sub
    // Finder would keep prioritizing a bad/blacklisted sub forever.
    await query(
      `update subcontractors
          set responsiveness_score=$2, reliability_score=$3, is_preferred=$4
        where id=$1`,
      [s.id, responsiveness, reliability, isPreferred]
    );
    updated++;
  }
  return { updated, promoted };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
