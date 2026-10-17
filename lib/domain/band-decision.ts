/**
 * The 50-69 band. Scores the account already treats as pursue or dismiss
 * are not decided here. Scores above 69 that are still below a raised
 * pursue threshold stay with a person.
 */

export const AUTONOMOUS_BAND_MIN = 50;
export const AUTONOMOUS_BAND_MAX = 69;

export function eligibleForBandDecision(
  score: number,
  thresholds: { pursue_min_score: number; review_min_score: number }
): boolean {
  if (!Number.isFinite(score)) return false;
  return (
    score >= AUTONOMOUS_BAND_MIN &&
    score <= AUTONOMOUS_BAND_MAX &&
    score >= thresholds.review_min_score &&
    score < thresholds.pursue_min_score
  );
}

export type BandChoice = "pursue" | "pass";

export interface BandDecision {
  choice: BandChoice;
  reasons: string[];
  fitCriteriaChecked: string[];
  /** Joined reasons, stored on the opportunity and written to the agent log. */
  reasoning: string;
}
