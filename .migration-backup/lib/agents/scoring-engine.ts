/**
 * SCORING ENGINE — triggered on every new opportunity.
 * Applies the 100-point rubric from the Company Profile. Checks hard exclusions
 * FIRST (deterministic + Claude for free-text rules). Assigns tier: pursue (>=70),
 * review (50-69), dismiss (<50). Logs the full breakdown. On pursue: triggers
 * Solicitation Analyst and Pricing Research in parallel. On review: sets a 4-hour
 * auto-dismiss timer and surfaces a review card. On dismiss: closes + logs.
 */
import { z } from "zod";
import { query, queryOne } from "../db";
import { getProfileJson } from "../ai/companyProfile";
import { completeJson, ClaudeNotConfiguredError } from "../ai/claude";
import { logAgent } from "../logger";
import {
  checkHardExclusions,
  buildScoreBreakdown,
  type DimensionScore,
} from "../domain/scoring";
import type { AgentDefinition } from "./types";
import type { AgentResult, Opportunity } from "../types";

const DimSchema = z.object({
  dimensions: z.array(
    z.object({
      key: z.string(),
      points: z.number(),
      reasoning: z.string(),
    })
  ),
  extra_exclusions: z.array(z.string()).default([]),
  summary: z.string(),
});

export const scoringEngine: AgentDefinition = {
  name: "scoring-engine",
  label: "Scoring Engine",
  description:
    "Applies the 100-point rubric + hard exclusions, tiers the opportunity, routes downstream.",
  cron: undefined,
  // Has a deterministic heuristic fallback when Claude is unavailable (lands
  // items in review for human triage), so it still runs without an API key.
  worksWithoutClaude: true,
  async handler(ctx): Promise<AgentResult> {
    const opportunityId = ctx.payload.opportunityId as string;
    if (!opportunityId) return { ok: false, summary: "no opportunityId in payload" };

    const opp = await queryOne<Opportunity>(`select * from opportunities where id = $1`, [
      opportunityId,
    ]);
    if (!opp) return { ok: false, summary: `opportunity ${opportunityId} not found` };

    const profile = await getProfileJson();
    if (!profile) return { ok: false, summary: "no active Company Profile" };

    // 1) Deterministic hard exclusions FIRST.
    const structuralExclusions = checkHardExclusions(opp, profile);

    // 2) Rubric scoring via Claude (per-dimension judgment against the profile).
    const rubric = profile.scoring_rubric;
    let dims: DimensionScore[] = [];
    let summary = "";
    let claudeExclusions: string[] = [];

    try {
      const prompt = buildScoringPrompt(opp, rubric.dimensions);
      const { data, usage } = await completeJson(prompt, {
        schema: DimSchema,
        maxTokens: 1500,
      });
      dims = data.dimensions.map((d) => {
        const dim = rubric.dimensions.find((x) => x.key === d.key);
        return {
          key: d.key,
          label: dim?.label ?? d.key,
          points: d.points,
          max_points: dim?.max_points ?? 0,
          reasoning: d.reasoning,
        };
      });
      claudeExclusions = data.extra_exclusions;
      summary = data.summary;
      await logAgent({
        agent: "scoring-engine",
        action: "score",
        opportunityId,
        message: `scored via Claude`,
        claudeUsage: usage,
      });
    } catch (err) {
      if (err instanceof ClaudeNotConfiguredError) {
        // Rule-only fallback: neutral mid scores so the item lands in review.
        dims = rubric.dimensions.map((d) => ({
          key: d.key,
          label: d.label,
          points: Math.round(d.max_points * 0.6),
          max_points: d.max_points,
          reasoning: "Claude not configured — neutral heuristic score; needs human review.",
        }));
        summary = "Scored heuristically (Claude disabled). Manual review recommended.";
      } else {
        throw err;
      }
    }

    const exclusions = [...new Set([...structuralExclusions, ...claudeExclusions])];
    const breakdown = buildScoreBreakdown(dims, exclusions, profile, summary);

    // 3) Persist score + tier + route.
    const enqueued: AgentResult["enqueued"] = [];
    let stage = opp.stage;
    let humanAction = false;
    let reviewExpires: string | null = null;
    let status = "open";

    if (breakdown.tier === "pursue") {
      stage = "analysis";
      enqueued.push(
        { agent: "solicitation-analyst", payload: { opportunityId } },
        { agent: "pricing-research", payload: { opportunityId } }
      );
    } else if (breakdown.tier === "review") {
      stage = "scoring";
      humanAction = true;
      reviewExpires = new Date(
        Date.now() + profile.decision_thresholds.review_auto_dismiss_hours * 3_600_000
      ).toISOString();
    } else {
      stage = "dismissed";
      status = "archived";
    }

    await query(
      `update opportunities
         set score=$2, score_breakdown=$3, tier=$4, stage=$5, status=$6,
             human_action_required=$7, review_expires_at=$8, risk_flags=$9
       where id=$1`,
      [
        opportunityId,
        breakdown.total,
        JSON.stringify(breakdown),
        breakdown.tier,
        stage,
        status,
        humanAction,
        reviewExpires,
        exclusions,
      ]
    );

    return {
      ok: true,
      summary: `Scored ${breakdown.total}/100 → ${breakdown.tier}${
        exclusions.length ? ` (excluded: ${exclusions.join(", ")})` : ""
      }`,
      reasoning: breakdown.summary,
      data: { total: breakdown.total, tier: breakdown.tier, exclusions },
      enqueued,
      humanActionRequired: humanAction,
    };
  },
};

function buildScoringPrompt(
  opp: Opportunity,
  dimensions: { key: string; label: string; max_points: number; guidance: string }[]
): string {
  const dimLines = dimensions
    .map((d) => `- ${d.key} ("${d.label}", max ${d.max_points} pts): ${d.guidance}`)
    .join("\n");
  return [
    "Score this government contracting opportunity against our rubric. Use the Company Profile (your system context) as the source of truth for what we pursue, our certifications, service areas, and thresholds.",
    "",
    "OPPORTUNITY:",
    `Title: ${opp.title ?? "(none)"}`,
    `Agency: ${opp.agency ?? "(none)"}`,
    `NAICS: ${opp.naics_code ?? "(none)"}  Set-aside: ${opp.set_aside_type ?? "(none)"}`,
    `Estimated value: ${opp.value_estimated ?? "(unknown)"}`,
    `Location: ${opp.location_state ?? "(unknown)"}`,
    `Deadline: ${opp.deadline ?? "(unknown)"}`,
    `Description: ${(opp.description ?? "").slice(0, 2000)}`,
    "",
    "RUBRIC DIMENSIONS (award points up to each max):",
    dimLines,
    "",
    "Also list any hard-exclusion keys from the profile that this opportunity triggers (free-text rules you must evaluate), in extra_exclusions. If none, use an empty array.",
    "",
    "Return JSON: { dimensions: [{ key, points, reasoning }], extra_exclusions: string[], summary: string }. Points must be integers within each dimension's max. The summary is 1-2 sentences on why this scored as it did.",
  ].join("\n");
}
