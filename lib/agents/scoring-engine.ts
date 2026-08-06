/**
 * SCORING ENGINE, triggered on every new opportunity.
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
  reconcileDimensions,
  reviewFlags,
  applyWeightOverrides,
  type DimensionScore,
} from "../domain/scoring";
import { intakeChecks, intakeVerdict } from "../domain/intake";
import { getAutomationRules } from "../app-settings";
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

    // 0) Intake quality gate, BEFORE any scoring spend: minimum lead time,
    // missing deadline, duplicate solicitation number. Nothing is excluded
    // silently: every finding is logged with a full explanation and lands on
    // the record's risk flags.
    const rules = await getAutomationRules();
    const dupRow = opp.solicitation_number
      ? await queryOne<{ n: number }>(
          `select count(*)::int as n from opportunities
            where solicitation_number = $1 and id <> $2 and status = 'open'`,
          [opp.solicitation_number, opportunityId]
        )
      : null;
    const findings = intakeChecks({
      deadline: opp.deadline,
      duplicateSolicitationCount: dupRow?.n ?? 0,
      rules,
      now: new Date(),
    });
    const gate = intakeVerdict(findings);
    for (const f of findings) {
      await logAgent({
        agent: "scoring-engine",
        action: `intake-${f.rule.replace(/_/g, "-")}`,
        opportunityId,
        level: f.verdict === "dismiss" ? "warn" : "info",
        message: f.explanation,
      });
    }
    if (gate === "dismiss") {
      await query(
        `update opportunities
            set stage='dismissed', status='archived', tier='dismiss',
                human_action_required=false,
                risk_flags = (select array(select distinct unnest(coalesce(risk_flags,'{}') || $2::text[])))
          where id=$1`,
        [opportunityId, findings.map((f) => f.flag)]
      );
      return {
        ok: true,
        summary: `Intake gate auto-passed this opportunity: ${findings
          .map((f) => f.rule.replace(/_/g, " "))
          .join(", ")}.`,
        reasoning: findings.map((f) => f.explanation).join(" "),
      };
    }
    const intakeFlags = findings.map((f) => f.flag);
    const forceIntakeReview = gate === "review";

    // 1) Deterministic hard exclusions FIRST.
    const structuralExclusions = checkHardExclusions(opp, profile);

    // Valid exclusion keys the model may return in extra_exclusions. Anything
    // outside this set is a hallucination and must be dropped, an unrecognized
    // exclusion string would otherwise zero the score and auto-dismiss a good
    // opportunity (buildScoreBreakdown forces dismiss on ANY exclusion).
    const validExclusionKeys = new Set(profile.hard_exclusions.map((e) => e.key));

    // 2) Rubric scoring via Claude (per-dimension judgment against the profile).
    // Apply any operator-approved Learning Loop weights (normalized to 100 pts) so
    // an approved weight version actually changes scoring; default = raw rubric.
    const activeWeights = await queryOne<{ weights: Record<string, unknown> }>(
      `select weights from scoring_weights where is_active = true limit 1`
    );
    const rubricDims = applyWeightOverrides(profile.scoring_rubric.dimensions, activeWeights?.weights);
    const rubric = { ...profile.scoring_rubric, dimensions: rubricDims };
    let dims: DimensionScore[] = [];
    let summary = "";
    let claudeExclusions: string[] = [];
    let missingKeys: string[] = [];
    let scoringIncomplete = false;

    try {
      const prompt = buildScoringPrompt(opp, rubric.dimensions, profile.hard_exclusions);
      const { data, usage } = await completeJson(prompt, {
        schema: DimSchema,
        maxTokens: 1500,
      });
      // Reconcile against the FULL rubric so an omitted dimension can't silently
      // understate the total; a partial response routes to human review below.
      const reconciled = reconcileDimensions(rubric.dimensions, data.dimensions);
      dims = reconciled.dims;
      missingKeys = reconciled.missingKeys;
      scoringIncomplete = missingKeys.length > 0;
      // Drop any exclusion key the model invented.
      claudeExclusions = data.extra_exclusions.filter((k) => validExclusionKeys.has(k));
      summary = data.summary;
      await logAgent({
        agent: "scoring-engine",
        action: "score",
        opportunityId,
        message: scoringIncomplete
          ? `scored via Claude (incomplete: missing ${missingKeys.join(", ")})`
          : `scored via Claude`,
        claudeUsage: usage,
      });
    } catch (err) {
      // Missing key OR any transient Claude error (429/5xx/network): fall back to
      // a neutral heuristic so scoring never blocks the pipeline. The item lands
      // in review for a human rather than crashing the job (which would retry and
      // could jam intake during a Claude outage).
      const heuristic = !(err instanceof ClaudeNotConfiguredError);
      dims = rubric.dimensions.map((d) => ({
        key: d.key,
        label: d.label,
        points: Math.round(d.max_points * 0.6),
        max_points: d.max_points,
        reasoning: heuristic
          ? "Claude error, neutral heuristic score; needs human review."
          : "Claude not configured, neutral heuristic score; needs human review.",
      }));
      summary = heuristic
        ? `Scored heuristically (Claude error: ${(err as Error).message}). Manual review recommended.`
        : "Scored heuristically (Claude disabled). Manual review recommended.";
      scoringIncomplete = true;
    }

    const exclusions = [...new Set([...structuralExclusions, ...claudeExclusions])];
    const breakdown = buildScoreBreakdown(dims, exclusions, profile, summary);

    // Non-dismiss review flags (e.g. value over $350K) + incomplete scoring both
    // downgrade an otherwise-pursue result to human review, never auto-pursue on
    // a partial score or a contract larger than the company can self-approve.
    const flags = reviewFlags(opp, profile);
    if (scoringIncomplete) flags.push("incomplete_scoring");
    flags.push(...intakeFlags);
    const forceReview =
      (flags.length > 0 || forceIntakeReview) && breakdown.tier === "pursue";
    if (forceReview) breakdown.tier = "review";

    // 3) Persist score + tier + route.
    const enqueued: AgentResult["enqueued"] = [];
    let stage = opp.stage;
    let humanAction = false;
    let reviewExpires: string | null = null;
    let status = "open";

    if (breakdown.tier === "pursue") {
      // AUTO-PURSUE, unconditional above the pursue threshold (operator preference).
      // A score >= pursue_min_score that isn't hard-excluded advances straight into
      // the pipeline (analysis -> pricing -> subs -> outreach) with NO human gate.
      // Risk conditions (high value, new NAICS, unusual clauses, prime-only) do not
      // stop it here; a human still reviews before any bid is submitted.
      stage = "analysis";
      humanAction = false;
      enqueued.push(
        {
          agent: "solicitation-analyst",
          payload: { opportunityId },
          opts: { singletonKey: `analyze:${opportunityId}`, singletonSeconds: 3600 },
        },
        {
          agent: "pricing-research",
          payload: { opportunityId },
          opts: { singletonKey: `price:${opportunityId}`, singletonSeconds: 3600 },
        }
      );
      await logAgent({
        agent: "scoring-engine",
        action: "auto-pursue",
        opportunityId,
        level: "success",
        message: `Auto-pursued: ${breakdown.total} >= pursue threshold ${profile.decision_thresholds.pursue_min_score}. Pipeline started, no human action required.`,
      });
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
        [...new Set([...exclusions, ...flags])],
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
  dimensions: { key: string; label: string; max_points: number; guidance: string }[],
  hardExclusions: { key: string; label: string; rule: string }[]
): string {
  const dimLines = dimensions
    .map((d) => `- ${d.key} ("${d.label}", max ${d.max_points} pts): ${d.guidance}`)
    .join("\n");
  const exclLines = hardExclusions
    .map((e) => `- ${e.key} ("${e.label}"): ${e.rule}`)
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
    "RUBRIC DIMENSIONS (award points up to each max, you MUST return every dimension key below):",
    dimLines,
    "",
    "HARD-EXCLUSION RULES, in extra_exclusions, return ONLY keys from this exact list that this opportunity triggers (evaluate the free-text rules). Never invent a key; if none apply, use an empty array:",
    exclLines,
    "",
    "Return JSON: { dimensions: [{ key, points, reasoning }], extra_exclusions: string[], summary: string }. Include ALL rubric dimension keys. Points must be integers within each dimension's max. The summary is 1-2 sentences on why this scored as it did.",
  ].join("\n");
}
