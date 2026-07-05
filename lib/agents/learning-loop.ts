/**
 * LEARNING LOOP — weekly cron (Mondays 09:00). Closes the feedback loop:
 *  1) Analyzes recent won/lost bids against the scoring dimensions (via Claude)
 *     and proposes new scoring weights as an INACTIVE scoring_weights version
 *     (operator approves later to activate — this agent never activates).
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
import { email } from "../integrations/resend";
import type { AgentDefinition } from "./types";
import type { AgentResult, ScoreBreakdown } from "../types";

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
    const profile = await getProfileJson();

    // --- Load recent decided bids. ---
    const outcomes = await query<BidOutcomeRow>(
      `select b.id, b.opportunity_id, b.bid_amount, b.margin_pct, b.outcome, b.loss_reason,
              o.naics_code, o.score_breakdown, o.tier
         from bids b
         join opportunities o on o.id = b.opportunity_id
        where b.outcome in ('won','lost')
        order by b.updated_at desc
        limit 100`
    );

    const wins = outcomes.filter((o) => o.outcome === "won").length;
    const losses = outcomes.filter((o) => o.outcome === "lost").length;

    // --- Current active weights (baseline for proposals). ---
    const activeWeights = await queryOne<{ version: number; weights: Record<string, unknown> }>(
      `select version, weights from scoring_weights where is_active = true limit 1`
    );
    const currentWeights: Record<string, unknown> = activeWeights?.weights ?? {};

    // --- Analyze via Claude. ---
    let analysis: z.infer<typeof AnalysisSchema> | null = null;
    let claudeSkipped = false;
    if (outcomes.length > 0) {
      const prompt = buildAnalysisPrompt(outcomes, currentWeights, profile?.scoring_rubric?.dimensions ?? []);
      try {
        const { data, usage } = await completeJson(prompt, {
          schema: AnalysisSchema,
          model: config.claude.modelSmart, // rubric-weight reasoning — worth the stronger model
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
            message: "Claude not configured — skipping weight analysis this run.",
          });
        } else {
          throw err;
        }
      }
    }

    // --- Propose a new INACTIVE scoring_weights version (never activate). ---
    let proposedVersion: number | null = null;
    if (analysis && analysis.weight_adjustments.length > 0) {
      const maxVersion = await queryOne<{ max: number }>(
        `select coalesce(max(version),0) as max from scoring_weights`
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
      await query(
        `insert into scoring_weights
           (version, weights, rationale, is_active, proposed_by, proposed_at, supporting_data)
         values ($1,$2,$3,false,'learning-loop',now(),$4)`,
        [
          proposedVersion,
          JSON.stringify(mergedWeights),
          rationale,
          JSON.stringify(analysis.supporting_data ?? {}),
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
    const subUpdates = await recomputeSubScores();

    // --- Weekly report. ---
    const reportLines: string[] = [];
    reportLines.push(`Learning Loop weekly report`);
    reportLines.push(
      `Outcomes analyzed: ${outcomes.length} (${wins} won, ${losses} lost).`
    );
    if (proposedVersion) {
      reportLines.push(`Proposed scoring weights v${proposedVersion} (inactive — approve to apply).`);
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
    if (email.enabled()) {
      const html = `<h2>Learning Loop — Weekly Report</h2><pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(
        report
      )}</pre>`;
      await email.sendDigest({
        subject: `BROSTCO Learning Loop — ${wins}W/${losses}L this cycle`,
        html,
        text: report,
      });
    }

    return {
      ok: true,
      summary: `Learning loop complete: ${outcomes.length} outcomes (${wins}W/${losses}L)${
        proposedVersion ? `, proposed weights v${proposedVersion}` : ""
      }; ${subUpdates.updated} subs updated, ${subUpdates.promoted} promoted.`,
      reasoning: report,
      data: {
        outcomes: outcomes.length,
        wins,
        losses,
        proposedVersion,
        subUpdated: subUpdates.updated,
        subPromoted: subUpdates.promoted,
      },
    };
  },
};

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
async function recomputeSubScores(): Promise<SubUpdateResult> {
  const subs = await query<{
    id: string;
    blacklisted: boolean;
    outreach: number;
    responded_48h: number;
    responded_any: number;
    quote_count: number;
  }>(
    `select s.id,
            s.blacklisted,
            count(distinct c.id) filter (where c.direction='outbound') as outreach,
            count(distinct c.id) filter (
              where c.replied_at is not null
                and c.replied_at <= c.created_at + interval '48 hours'
            ) as responded_48h,
            count(distinct c.id) filter (where c.replied_at is not null) as responded_any,
            count(distinct q.id) as quote_count
       from subcontractors s
       left join communications c on c.subcontractor_id = s.id
       left join quotes q on q.subcontractor_id = s.id
      group by s.id, s.blacklisted
     having count(distinct c.id) > 0 or count(distinct q.id) > 0`
  );

  let updated = 0;
  let promoted = 0;
  for (const s of subs) {
    const outreach = Number(s.outreach);
    const resp48 = Number(s.responded_48h);
    const respAny = Number(s.responded_any);
    const quotes = Number(s.quote_count);

    // Responsiveness: fraction responding within 48h, weighted toward fast replies.
    let responsiveness: number;
    if (outreach === 0) {
      responsiveness = quotes > 0 ? 60 : 50; // no outreach on record; neutral-ish
    } else {
      const fast = resp48 / outreach;
      const any = respAny / outreach;
      responsiveness = Math.round(Math.min(100, fast * 80 + any * 20));
    }

    // Reliability heuristic: base on quote presence, penalize blacklist, blend responsiveness.
    let reliability: number;
    if (s.blacklisted) {
      reliability = 0;
    } else {
      const quoteBonus = quotes > 0 ? 40 : 0;
      reliability = Math.round(Math.min(100, 30 + quoteBonus + responsiveness * 0.3));
    }

    const isPreferred = !s.blacklisted && reliability >= 80;
    if (isPreferred) promoted++;

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
