/**
 * Decide one saved 50-69 score that never received a pursue-or-pass.
 *
 * This does not score again. A second rubric call would bill another
 * completion and could change the number the decision is about. The update
 * matches only a row that still has no decision, so two sweeps cannot both
 * write one.
 */
import { query } from "../db";
import { logAgent } from "../logger";
import { getAutomationRules, getWorkExecution } from "../app-settings";
import { getProfileJson } from "../ai/companyProfile";
import { decideReviewBand } from "../ai/band-decision";
import { outreachAllowed } from "../domain/work-mode";
import { jobsAfterFinalPursue } from "../domain/score-downstream";
import { bandBackfillSkip, bandBackfillWrite } from "../domain/band-backfill";
import type { AgentResult, Opportunity } from "../types";

type Saved = Opportunity & { band_decision?: "pursue" | "pass" | null };

export async function decideSavedBand(opp: Saved): Promise<AgentResult> {
  const opportunityId = opp.id;
  const orgId = opp.org_id;
  if (!orgId) {
    return { ok: false, summary: "Band decision stopped because this opportunity has no organization owner." };
  }
  const [rules, profile, workMode] = await Promise.all([
    getAutomationRules(),
    getProfileJson(),
    getWorkExecution(),
  ]);
  if (!profile) return { ok: false, summary: "no active Company Profile" };

  const exclusions = opp.score_breakdown?.hard_exclusions_triggered ?? [];
  const action = bandBackfillSkip({
    score: opp.score,
    tier: opp.tier,
    status: opp.status ?? null,
    stage: opp.stage,
    bandDecision: opp.band_decision ?? null,
    riskFlags: opp.risk_flags ?? [],
    hardExclusions: exclusions,
    autonomous: rules.autonomous_review_decisions,
    pursuitActive: (opp.pursuit_state ?? "active") === "active",
    thresholds: profile.decision_thresholds,
  });
  if (action === "skip") {
    await logAgent({
      agent: "scoring-engine",
      action: "band-decision-ineligible",
      opportunityId,
      level: "info",
      status: "skipped",
      message: "This saved score is not eligible for an automatic 50-69 decision. It was left unchanged.",
    });
    return {
      ok: true,
      summary: "Saved score is not eligible for an automatic band decision.",
    };
  }

  const decision = await decideReviewBand({
    title: opp.title,
    score: opp.score ?? 0,
    summary: opp.score_breakdown?.summary ?? `Recorded score ${opp.score}/100.`,
    deadline: opp.deadline,
    notice: {
      naics: opp.naics_code,
      setAside: opp.set_aside_type,
      place: [opp.location_text, opp.location_state].filter(Boolean).join(", ") || null,
      value: opp.value_estimated,
    },
    company: {
      naics: profile.naics_codes ?? [],
      serviceAreas: profile.service_areas ?? [],
      smallBusiness: profile.small_business ?? null,
      certifications: profile.certifications ?? [],
      annualRevenue: profile.annual_revenue ?? null,
    },
  });
  if (!decision) {
    await logAgent({
      agent: "scoring-engine",
      action: "band-decision-waiting",
      opportunityId,
      level: "warn",
      status: "skipped",
      message: `The 50-69 decision for ${opp.score}/100 did not return a reason. The score was kept and will be tried on the next sweep.`,
    });
    return {
      ok: true,
      summary: "The band decision was not available. The saved score was left unchanged.",
    };
  }

  const sourcingAllowed = outreachAllowed(workMode, opp);
  const write = bandBackfillWrite(decision.choice, opp.stage, sourcingAllowed);
  const patch = {
    tier: write.tier,
    band_decision: decision.choice,
    band_decision_reasoning: decision.reasoning,
    band_fit_criteria: decision.fitCriteriaChecked,
  };
  const saved = await query<{ id: string }>(
    `update opportunities
        set band_decision = $2,
            band_decision_reasoning = $3,
            band_decision_at = now(),
            tier = $4,
            stage = $5,
            status = $6,
            human_action_required = $7,
            review_expires_at = null,
            score_breakdown = coalesce(score_breakdown, '{}'::jsonb) || $8::jsonb
      where id = $1 and org_id = $9
        and band_decision is null
        and tier = 'review'
        and status = 'open'
      returning id`,
    [
      opportunityId,
      decision.choice,
      decision.reasoning,
      write.tier,
      write.stage,
      write.status,
      write.humanAction,
      JSON.stringify(patch),
      orgId,
    ]
  );
  if (saved.length === 0) {
    return { ok: true, summary: "A band decision was already stored. Nothing was written again." };
  }

  await logAgent({
    agent: "scoring-engine",
    action: "band-decision",
    opportunityId,
    level: "info",
    message: `Review-band decision: ${decision.choice} at ${opp.score}/100.`,
    reasoning: `${decision.reasoning} Fit checked: ${decision.fitCriteriaChecked.join(", ")}.`,
  });

  const enqueued: AgentResult["enqueued"] = [];
  if (write.enqueuePricingOnly) {
    enqueued.push({
      agent: "pricing-research",
      payload: { opportunityId },
      opts: { singletonKey: `price:${opportunityId}`, singletonSeconds: 3600 },
    });
  } else if (write.enqueueSourcing) {
    for (const job of jobsAfterFinalPursue(opportunityId)) {
      enqueued.push({
        ...job,
        opts: {
          singletonKey: `${job.agent}:${opportunityId}`,
          singletonSeconds: 3600,
        },
      });
    }
  }

  return {
    ok: true,
    summary: `Review-band decision: ${decision.choice} at ${opp.score}/100.`,
    reasoning: decision.reasoning,
    data: { choice: decision.choice, score: opp.score },
    enqueued,
    humanActionRequired: write.humanAction,
  };
}
