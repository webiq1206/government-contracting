import type { GuideSubEvidence } from '@/lib/domain/guide-progress';
import type { SubStandards } from '@/lib/types';

export const guideStandards: SubStandards = {
  min_google_rating: 3.8, min_reviews: 3, require_active_license: true,
  require_not_sam_excluded: true, candidates_per_trade: 10, verify_top_n: 5,
};
export function guideSub(overrides: Partial<GuideSubEvidence> = {}): GuideSubEvidence {
  return {
    trade: 'Roofing', verified: true, archived_at: null, blacklisted: false,
    sam_excluded: false, license_status: 'active', google_rating: 4.7, review_count: 25,
    email: 'synthetic@example.invalid', email_verified: true, phone: null,
    verification_json: { sam_confirmed: true, sam_excluded: false, unresolved_failures: [], notes: [] },
    outreach_state: 'sent', emails_sent: 1, calls_logged: 0, has_trade_contact: true,
    ...overrides,
  };
}
