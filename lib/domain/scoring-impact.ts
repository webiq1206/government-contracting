/**
 * What moving a scoring threshold would actually do.
 *
 * The auto-pursue number is the single most consequential control in this
 * product, and the page let it be changed with no indication of the effect.
 * Lowering it from 70 to 60 does not merely reclassify rows in a table: an
 * opportunity crossing into `pursue` is analysed, priced, researched and then
 * emailed to subcontractors automatically, with no human step. Somebody
 * nudging a number to "see what happens" was sending real mail to real firms
 * about work nobody had decided to bid.
 *
 * So the effect is computed before the save, from the scores already on file,
 * and the direction that starts outreach is called out on its own. The
 * arithmetic is deliberately the same `assignTier` the Scoring Engine uses,
 * imported rather than reimplemented: a preview that disagrees with what the
 * engine then does is worse than no preview at all.
 */
import { assignTier } from "./scoring";
import type { Tier } from "../types";

/** How many opportunities sit at each score. Index is the score, 0 to 100. */
export type ScoreHistogram = number[];

export interface Thresholds {
  pursue_min_score: number;
  review_min_score: number;
}

export interface TierCounts {
  pursue: number;
  review: number;
  dismiss: number;
}

export interface ThresholdImpact {
  before: TierCounts;
  after: TierCounts;
  /** Opportunities that would start running automatically. The dangerous one. */
  intoPursue: number;
  /** Opportunities that would stop running automatically and wait for a person. */
  outOfPursue: number;
  intoReview: number;
  outOfReview: number;
  /** Newly dismissed. Work that would stop being offered at all. */
  intoDismiss: number;
  outOfDismiss: number;
  /** Total opportunities the histogram covers, so a count can state its base. */
  total: number;
  /** True when nothing at all would move. */
  unchanged: boolean;
}

function countTiers(hist: ScoreHistogram, t: Thresholds): TierCounts {
  const out: TierCounts = { pursue: 0, review: 0, dismiss: 0 };
  for (let score = 0; score < hist.length; score += 1) {
    const n = hist[score] ?? 0;
    if (n <= 0) continue;
    out[assignTier(score, t)] += n;
  }
  return out;
}

export function thresholdImpact(
  hist: ScoreHistogram,
  before: Thresholds,
  after: Thresholds
): ThresholdImpact {
  const b = countTiers(hist, before);
  const a = countTiers(hist, after);
  let intoPursue = 0;
  let outOfPursue = 0;
  let intoReview = 0;
  let outOfReview = 0;
  let intoDismiss = 0;
  let outOfDismiss = 0;
  let total = 0;
  for (let score = 0; score < hist.length; score += 1) {
    const n = hist[score] ?? 0;
    if (n <= 0) continue;
    total += n;
    const from: Tier = assignTier(score, before);
    const to: Tier = assignTier(score, after);
    if (from === to) continue;
    if (to === "pursue") intoPursue += n;
    if (from === "pursue") outOfPursue += n;
    if (to === "review") intoReview += n;
    if (from === "review") outOfReview += n;
    if (to === "dismiss") intoDismiss += n;
    if (from === "dismiss") outOfDismiss += n;
  }
  return {
    before: b,
    after: a,
    intoPursue,
    outOfPursue,
    intoReview,
    outOfReview,
    intoDismiss,
    outOfDismiss,
    total,
    unchanged:
      intoPursue + outOfPursue + intoReview + outOfReview + intoDismiss + outOfDismiss === 0,
  };
}

export interface ThresholdProblem {
  /** Whether the settings cannot be saved at all, or merely deserve a warning. */
  severity: "error" | "warning";
  message: string;
}

/**
 * Settings that are wrong, and settings that are legal but alarming.
 *
 * The distinction matters: an error is a save the system refuses, a warning is
 * a decision the operator is allowed to make once they have seen it stated.
 * Auto-pursuing at 1 is not invalid, it is a choice to email subcontractors
 * about everything, and refusing it would be this page overriding its user.
 */
export function thresholdProblems(t: Thresholds): ThresholdProblem[] {
  const out: ThresholdProblem[] = [];
  const pursue = t.pursue_min_score;
  const review = t.review_min_score;
  if (!Number.isFinite(pursue) || !Number.isFinite(review)) {
    out.push({ severity: "error", message: "Both thresholds have to be numbers." });
    return out;
  }
  if (pursue < 1 || pursue > 100) {
    out.push({ severity: "error", message: "The auto-pursue score has to be between 1 and 100." });
  }
  if (review < 1 || review > 100) {
    out.push({ severity: "error", message: "The review floor has to be between 1 and 100." });
  }
  if (review >= pursue) {
    out.push({
      severity: "error",
      message:
        "The review floor has to be below the auto-pursue score, or there is no review band and nothing is ever offered for a decision.",
    });
  }
  if (pursue <= 40) {
    out.push({
      severity: "warning",
      message:
        "Auto-pursuing at this score means most opportunities are emailed to subcontractors without anybody looking first.",
    });
  }
  if (pursue - review > 60) {
    out.push({
      severity: "warning",
      message:
        "A review band this wide sends almost everything to the Review Queue, which is a lot of decisions for a person to make.",
    });
  }
  return out;
}

/** The sentence that goes above the numbers. Never neutral about starting outreach. */
export function describeImpact(impact: ThresholdImpact): string {
  if (impact.total === 0) {
    return "There are no scored opportunities on file yet, so there is nothing to reclassify. This will apply to everything scored from now on.";
  }
  if (impact.unchanged) {
    return `Nothing moves. All ${impact.total} scored opportunities keep the recommendation they have.`;
  }
  const parts: string[] = [];
  if (impact.intoPursue > 0) {
    parts.push(
      `${impact.intoPursue} would start running automatically, which includes emailing subcontractors`
    );
  }
  if (impact.outOfPursue > 0) {
    parts.push(`${impact.outOfPursue} would stop running automatically and wait for you`);
  }
  if (impact.intoDismiss > 0) {
    parts.push(`${impact.intoDismiss} would no longer be offered at all`);
  }
  if (impact.outOfDismiss > 0) {
    parts.push(`${impact.outOfDismiss} previously dismissed would come back`);
  }
  if (parts.length === 0) {
    // Only review-band shuffling, which is real but harmless.
    parts.push(`${impact.intoReview + impact.outOfReview} would change which queue they sit in`);
  }
  return `Of ${impact.total} scored opportunities, ${parts.join("; ")}.`;
}
