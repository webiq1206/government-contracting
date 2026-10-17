/**
 * A day of new solicitations with no finished score is a stall, even when
 * every job "succeeded" on a heuristic.
 */
export const SCORING_STALL_CAUSE = "scoring_stall";
export const SCORING_WATCH_WINDOW_MS = 24 * 60 * 60_000;

export function scoringWatchDecision(input: {
  completedScores: number;
  arrived: number;
  incidentOpen: boolean;
}): "alert" | "resolve" | "quiet" {
  if (input.completedScores > 0) return input.incidentOpen ? "resolve" : "quiet";
  if (input.arrived > 0) return "alert";
  return "quiet";
}
