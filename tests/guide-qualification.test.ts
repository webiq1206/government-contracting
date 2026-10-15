import { describe, expect, it } from 'vitest';
import { hasQualifiedGuideEvidence, verifiedGuideProgress } from '@/lib/domain/guide-progress';
import { summarizeTradeCoverage } from '@/lib/domain/trade-coverage';
import { guideStandards, guideSub } from './helpers/guide-evidence';

describe('saved qualification evidence for workflow completion', () => {
  it('accepts positive saved facts against the current company standards', () => {
    expect(hasQualifiedGuideEvidence(guideSub(), guideStandards)).toBe(true);
    expect(hasQualifiedGuideEvidence(guideSub({ email: null, email_verified: false, phone: '5550100' }), guideStandards)).toBe(true);
  });
  it.each([
    { verification_json: null }, { verification_json: {} }, { verified: false },
    { sam_excluded: true }, { sam_excluded: undefined }, { blacklisted: true },
    { archived_at: '2026-10-01' }, { license_status: 'expired' }, { license_status: null },
    { google_rating: 2 }, { google_rating: null }, { review_count: 1 }, { review_count: null },
    { email_verified: false, phone: null },
    { verification_json: { ...guideSub().verification_json, sam_excluded: true } },
    { verification_json: { ...guideSub().verification_json, sam_confirmed: false } },
    { verification_json: { ...guideSub().verification_json, unresolved_failures: ['lookup failed'] } },
    { verification_json: { ...guideSub().verification_json, notes: ['SAM exclusions check disabled because no account API key is connected.'] } },
  ])('does not promote missing or failed qualification facts: %j', overrides => {
    expect(hasQualifiedGuideEvidence(guideSub(overrides), guideStandards)).toBe(false);
  });
  it('requires standards to load and applies updated thresholds', () => {
    expect(hasQualifiedGuideEvidence(guideSub(), null)).toBe(false);
    expect(hasQualifiedGuideEvidence(guideSub(), { ...guideStandards, min_google_rating: 4.8 })).toBe(false);
    expect(hasQualifiedGuideEvidence(guideSub(), { ...guideStandards, min_reliability_score: 80 })).toBe(false);
    expect(hasQualifiedGuideEvidence(guideSub({ reliability_score: 80 }), { ...guideStandards, min_reliability_score: 80 })).toBe(true);
  });
  it('keeps raw call history separate from reached-firm evidence', () => {
    const subs = [guideSub({ emails_sent: 0, calls_logged: 1, has_trade_contact: false })];
    expect(verifiedGuideProgress({ standards: guideStandards, subs,
      sourceEvidence: { analysisInputHash: 'synthetic', completeness: { ok: true, missing: [] } },
      coverage: summarizeTradeCoverage({ requiredTrades: ['Roofing'], subs, quotes: [] }),
    })).toEqual({ analysisComplete: true, subsFound: true, subsContacted: false, callsRecorded: true });
  });
});
