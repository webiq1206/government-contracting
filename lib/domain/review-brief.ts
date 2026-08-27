/**
 * The case for and against one borderline opportunity, in decision order.
 *
 * Review is a page whose entire job is a yes or no, and it was a list of
 * cards. A card is a summary; a decision needs the argument. The order below
 * is the order somebody actually makes the call in -- what we think, why,
 * what is wrong with it, what we do not know, and how long there is -- rather
 * than the order the fields happen to sit in on the row.
 *
 * Everything here is derived from what the scoring already produced. Nothing
 * is invented: where a fact is missing the brief says it is missing, because
 * "we could not read the value" is itself one of the strongest arguments for
 * not pursuing something.
 *
 * Pure.
 */

import { flagLabel } from "../flag-labels";
import type { DataConfidence } from "./score-confidence";
import type { FactConflict } from "./brief-conflicts";

export type Recommendation = "pursue" | "pass" | "look";

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  pursue: "Worth pursuing",
  pass: "Probably pass",
  look: "Needs a person to look",
};

export interface ScoreDimension {
  key: string;
  label: string;
  points: number;
  max_points: number;
  reasoning: string;
}

export interface BriefInput {
  score: number | null;
  dimensions: ScoreDimension[];
  riskFlags: string[];
  confidence: DataConfidence | null;
  deadline: string | null;
  reviewExpiresAt: string | null;
  requiredTradeCount: number | null;
  valueKnown: boolean;
  pastPerfClassification: string | null;
  /** The published figure, when there is one. Null is not zero. */
  value: number | null;
  /** Where that figure came from: the notice, an analysis, or nothing. */
  valueSource: string | null;
  /** Disagreements between the notice and the document. See brief-conflicts. */
  conflicts: FactConflict[];
  /** Where to read the original. */
  sourceLinks: { label: string; href: string }[];
}

export interface BriefPoint {
  label: string;
  detail: string;
}

export interface ReviewBrief {
  recommendation: Recommendation;
  /** One sentence saying why that is the recommendation. */
  rationale: string;
  score: number | null;
  confidence: DataConfidence | null;
  /** The three dimensions carrying the most of the score. */
  positives: BriefPoint[];
  /** The three risks that matter most. */
  risks: BriefPoint[];
  /** Facts the scoring could not establish. The reading list. */
  missing: string[];
  deadline: string | null;
  autoDismissAt: string | null;
  /**
   * What pursuing this actually costs, in work rather than in hours.
   *
   * Never a number of minutes. The last time this product printed an effort
   * estimate it was the item count times six, which is a constant wearing the
   * costume of a measurement. Trades to cover and a package to assemble are
   * things somebody can check.
   */
  effort: string[];
  /** The published value and where it came from, or the absence of both. */
  value: { amount: number | null; source: string | null };
  /**
   * Two sources stating different facts.
   *
   * A separate list from `missing` on purpose. Something nobody stated is a
   * gap; something stated twice, differently, is the thing most likely to lose
   * a bid, and a brief that files them together buries it.
   */
  conflicts: FactConflict[];
  /** The notice itself, and anything else worth reading first-hand. */
  sourceLinks: { label: string; href: string }[];
}

function pct(d: ScoreDimension): number {
  return d.max_points > 0 ? d.points / d.max_points : 0;
}

/**
 * The recommendation.
 *
 * Three outcomes, not two, and the third one is the honest answer for a
 * solicitation nobody could read properly. Recommending a pass on thin data
 * would teach the operator that the system passes on anything it does not
 * understand; recommending a pursue would spend a day on a job that might not
 * exist. "Someone has to look" is what is actually true.
 */
export function recommend(i: BriefInput): { recommendation: Recommendation; rationale: string } {
  const blocking = i.riskFlags.filter((f) => f === "prime_only" || f === "ineligible_set_aside");
  if (blocking.length > 0) {
    return {
      recommendation: "pass",
      rationale: `${flagLabel(blocking[0])} rules this out regardless of how well it scores.`,
    };
  }

  const low = i.confidence != null && i.confidence.level === "low";
  if (low) {
    return {
      recommendation: "look",
      rationale:
        "Too little of the solicitation could be read to score it honestly. Open the notice before deciding.",
    };
  }

  const score = i.score ?? 0;
  if (score >= 65) {
    return {
      recommendation: "pursue",
      rationale: "Scores at the top of the borderline band with nothing blocking it.",
    };
  }
  if (score <= 54 && i.riskFlags.length >= 2) {
    return {
      recommendation: "pass",
      rationale: "Low in the band and carrying more than one risk.",
    };
  }
  return {
    recommendation: "look",
    rationale: "Squarely borderline. The tie-breaker is whether the trades are ones you already cover.",
  };
}

export function buildReviewBrief(i: BriefInput): ReviewBrief {
  const { recommendation, rationale } = recommend(i);
  const value = { amount: i.value ?? null, source: i.valueSource ?? null };

  const positives = [...i.dimensions]
    .filter((d) => d.max_points > 0 && pct(d) >= 0.5)
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)
    .map((d) => ({
      label: `${d.label} (${d.points}/${d.max_points})`,
      detail: d.reasoning || "No reasoning was recorded for this dimension.",
    }));

  /*
   * Risks are the flags first, then the dimensions that scored badly. A flag
   * is something the system decided is wrong; a weak dimension is something
   * that simply did not help. Mixing them in one ranked list would put "scored
   * 2 out of 10 on location" above "set-aside you do not qualify for".
   */
  const flagRisks: BriefPoint[] = i.riskFlags.slice(0, 3).map((f) => ({
    label: flagLabel(f),
    detail: "Flagged during scoring.",
  }));
  const weakRisks: BriefPoint[] = [...i.dimensions]
    .filter((d) => d.max_points > 0 && pct(d) < 0.35)
    .sort((a, b) => pct(a) - pct(b))
    .slice(0, 3 - flagRisks.length)
    .map((d) => ({
      label: `Weak on ${d.label.toLowerCase()} (${d.points}/${d.max_points})`,
      detail: d.reasoning || "No reasoning was recorded for this dimension.",
    }));
  const risks = [...flagRisks, ...weakRisks].slice(0, 3);

  const missing = i.confidence?.unknown ?? [];

  const effort: string[] = [];
  if (i.requiredTradeCount != null && i.requiredTradeCount > 0) {
    effort.push(
      `${i.requiredTradeCount} trade${i.requiredTradeCount === 1 ? "" : "s"} to find and quote`
    );
  } else {
    effort.push("Required trades not identified yet, so the sourcing effort is unknown");
  }
  effort.push("A bid package to assemble and check");
  if (!i.valueKnown) {
    effort.push("Pricing from comparable awards, because the value is not stated");
  }
  if (i.pastPerfClassification === "team_accepted") {
    effort.push("Past performance can come from the team, not just from you");
  }

  return {
    recommendation,
    rationale,
    score: i.score,
    confidence: i.confidence,
    positives,
    risks,
    missing,
    deadline: i.deadline,
    autoDismissAt: i.reviewExpiresAt,
    effort,
    value,
    conflicts: i.conflicts ?? [],
    sourceLinks: i.sourceLinks ?? [],
  };
}
