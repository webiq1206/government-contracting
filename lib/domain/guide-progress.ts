import { isActiveSubcontractor, type JourneyCompletion } from './journey';
import { assessSavedSolicitationCompleteness, type SavedSolicitationEvidence } from './saved-solicitation-completeness';
import { hasRecordedContact, type TradeCoverageSummary } from './trade-coverage';

/** Caller supplies tenant-scoped records and coverage of the available roster. */
export function verifiedGuideProgress(input: {
  sourceEvidence: SavedSolicitationEvidence;
  subs: readonly { trade: string | null; verified?: boolean | null; removed_at?: unknown;
    outreach_state?: string | null; emails_sent: number; calls_logged: number }[];
  coverage: TradeCoverageSummary;
}) {
  const active = input.subs.filter(isActiveSubcontractor);
  const qualified = active.filter(s => s.verified === true);
  const analysisComplete = assessSavedSolicitationCompleteness(input.sourceEvidence).complete;
  // A legacy stage, a candidate, or a receipt for a different trade cannot
  // complete the current solicitation's verified subcontractor coverage.
  const coversEveryTrade = (contacted: boolean) => analysisComplete &&
    input.coverage.trades.length > 0 && input.coverage.trades.every(t =>
      qualified.some(s => (s.trade?.trim() || 'General') === t.trade &&
        (!contacted || hasRecordedContact({ ...s, outreach_state: s.outreach_state ?? null }))));
  return {
    analysisComplete,
    subsFound: coversEveryTrade(false),
    subsContacted: coversEveryTrade(true),
    callsRecorded: active.some(s => s.calls_logged > 0),
  };
}

/** One completion map for the page strip and Guide Me. No stage input. */
export function verifiedJourneyCompletion(input: {
  score: number | null;
  progress?: ReturnType<typeof verifiedGuideProgress>;
  quoteCount: number;
  hasBid: boolean;
  bidSubmitted: boolean;
}): JourneyCompletion {
  return {
    monitoring: true,
    scoring: input.score != null && Number.isFinite(input.score),
    analysis: input.progress?.analysisComplete === true,
    sub_research: input.progress?.subsFound === true,
    outreach: input.progress?.subsContacted === true,
    call_queue: input.progress?.callsRecorded === true,
    quote_entry: input.quoteCount > 0,
    bid_building: input.hasBid,
    submitted: input.bidSubmitted,
  };
}
