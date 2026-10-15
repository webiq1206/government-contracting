import { isActiveSubcontractor, type JourneyCompletion } from './journey';
import { assessSavedSolicitationCompleteness, type SavedSolicitationEvidence } from './saved-solicitation-completeness';
import type { TradeCoverageSummary } from './trade-coverage';
import type { Subcontractor, SubStandards } from '../types';

export type GuideSubEvidence = { [K in
  'email' | 'email_verified' | 'phone' | 'google_rating' | 'review_count' |
  'reliability_score' | 'license_status' | 'sam_excluded' | 'blacklisted' | 'archived_at']?: Subcontractor[K] | null } & {
  trade: string | null;
  verified?: boolean | null;
  verification_json?: Record<string, unknown> | null;
  removed_at?: unknown;
  outreach_state?: string | null;
  emails_sent: number;
  calls_logged: number;
  /** Separate from opportunity/firm history: evidence for this exact trade. */
  has_trade_contact?: boolean;
};

/** Display evidence only. A completed lookup is not a passed standards gate. */
export function hasQualifiedGuideEvidence(sub: GuideSubEvidence, standards: SubStandards | null | undefined): boolean {
  const evidence = sub.verification_json;
  if (!standards || sub.verified !== true || !isActiveSubcontractor(sub) ||
      sub.archived_at != null || sub.blacklisted !== false || !evidence ||
      !Array.isArray(evidence.unresolved_failures) || evidence.unresolved_failures.length > 0 ||
      sub.sam_excluded !== false || evidence.sam_excluded !== false || evidence.sam_confirmed !== true) return false;

  // The producer also marks SAM "confirmed" when no API key is connected.
  // Its saved note distinguishes a disabled check from an actual check.
  if (standards.require_not_sam_excluded && (!Array.isArray(evidence.notes) ||
      evidence.notes.some(note => typeof note !== 'string' || /SAM exclusions check disabled/i.test(note)))) return false;
  if (standards.require_active_license && sub.license_status !== 'active') return false;
  const meets = (value: number | null | undefined, minimum: number | undefined) =>
    minimum == null || (Number.isFinite(minimum) && typeof value === 'number' && Number.isFinite(value) && value >= minimum);
  if (!meets(sub.google_rating, standards.min_google_rating) ||
      !meets(sub.review_count, standards.min_reviews) ||
      !meets(sub.reliability_score, standards.min_reliability_score)) return false;
  return Boolean((sub.email?.trim() && sub.email_verified === true) || sub.phone?.trim());
}

/** Caller supplies tenant-scoped records and coverage of the available roster. */
export function verifiedGuideProgress(input: {
  sourceEvidence: SavedSolicitationEvidence;
  standards?: SubStandards | null;
  subs: readonly GuideSubEvidence[];
  coverage: TradeCoverageSummary;
}) {
  const active = input.subs.filter(isActiveSubcontractor);
  const qualified = active.filter(s => hasQualifiedGuideEvidence(s, input.standards));
  const analysisComplete = assessSavedSolicitationCompleteness(input.sourceEvidence).complete;
  // A legacy stage, a candidate, or a receipt for a different trade cannot
  // complete the current solicitation's verified subcontractor coverage.
  const coversEveryTrade = (contacted: boolean) => analysisComplete &&
    input.coverage.trades.length > 0 && input.coverage.trades.every(t =>
      qualified.some(s => (s.trade?.trim() || 'General') === t.trade &&
        (!contacted || s.has_trade_contact === true)));
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
