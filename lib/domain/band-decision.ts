/**
 * The 50-69 band is the default human-review range. An account that raises
 * its pursue threshold above 70 has asked for a person to see those scores,
 * so this decision stays inside the default band.
 */

export const AUTONOMOUS_BAND_MIN = 50;
export const AUTONOMOUS_BAND_MAX = 69;

export function eligibleForBandDecision(
  score: number,
  thresholds: { pursue_min_score: number; review_min_score: number }
): boolean {
  if (!Number.isFinite(score)) return false;
  if (thresholds.pursue_min_score > 70) return false;
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
  reasoning: string;
}
