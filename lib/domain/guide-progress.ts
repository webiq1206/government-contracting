import { isActiveSubcontractor } from './journey';
import { assessSavedSolicitationCompleteness, type SavedSolicitationEvidence } from './saved-solicitation-completeness';
import type { TradeCoverageSummary } from './trade-coverage';

/** Caller supplies tenant-scoped records and coverage of the available roster. */
export function verifiedGuideProgress(input: {
  sourceEvidence: SavedSolicitationEvidence;
  subs: readonly { removed_at?: unknown; outreach_state?: string | null; calls_logged: number }[];
  coverage: TradeCoverageSummary;
}) {
  const active = input.subs.filter(isActiveSubcontractor);
  return {
    analysisComplete: assessSavedSolicitationCompleteness(input.sourceEvidence).complete,
    subsFound: active.length > 0 && input.coverage.trades.every(t => t.found > 0),
    subsContacted: active.length > 0 && input.coverage.trades.every(t => t.contacted > 0),
    callsRecorded: active.some(s => s.calls_logged > 0),
  };
}
