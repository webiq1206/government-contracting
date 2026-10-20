import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(), queryOne: vi.fn(), logAgent: vi.fn(), profile: vi.fn(),
  complete: vi.fn(), sam: vi.fn(), maps: vi.fn(), hunterSearch: vi.fn(),
  hunterFind: vi.fn(), hunterVerify: vi.fn(), scrape: vi.fn(), mx: vi.fn(),
  websiteSearch: vi.fn(), callsEnabled: vi.fn(),
}));
vi.mock("../lib/db", () => ({ query: mocks.query, queryOne: mocks.queryOne }));
vi.mock("../lib/logger", () => ({ logAgent: mocks.logAgent }));
vi.mock("../lib/ai/companyProfile", () => ({ getProfileJson: mocks.profile }));
vi.mock("../lib/ai/claude", () => ({
  complete: mocks.complete,
  ClaudeNotConfiguredError: class ClaudeNotConfiguredError extends Error {},
}));
vi.mock("../lib/integrations/sam", () => ({ sam: { isExcluded: mocks.sam } }));
vi.mock("../lib/integrations/googleMaps", () => ({ googleMaps: { placeDetails: mocks.maps } }));
vi.mock("../lib/integrations/hunter", () => ({ hunter: {
  domainSearch: mocks.hunterSearch, findEmail: mocks.hunterFind, verifyEmail: mocks.hunterVerify,
} }));
vi.mock("../lib/integrations/email-scrape", () => ({ scrapeWebsiteEmail: mocks.scrape, domainHasMx: mocks.mx,
  scrapeWebsiteEmailDetailed: async (site: string) => ({ email: await mocks.scrape(site), pagesRead: 1 }) }));
vi.mock("../lib/integrations/website-finder", () => ({ findWebsiteBysearch: mocks.websiteSearch }));
vi.mock("../lib/app-settings", () => ({ getWorkExecution: async () => "sub", areCallsEnabled: mocks.callsEnabled }));
vi.mock("../lib/tenant-context", () => ({ currentOrgId: () => "org-synthetic" }));
vi.mock("../lib/public-contact-backfill", () => ({ backfillPublicContact: vi.fn() }));

import { verifiedGuideProgress } from '../lib/domain/guide-progress';
import { summarizeTradeCoverage } from '../lib/domain/trade-coverage';
import { guideStandards, guideSub } from './helpers/guide-evidence';
import { subVerify } from "../lib/agents/sub-verify";

const context = { runId: "synthetic-run", trigger: "queue" as const,
  payload: { opportunityId: "opp-synthetic", subcontractorId: "sub-synthetic", trade: "Electrical" } };
function records(overrides: Record<string, unknown> = {}) {
  mocks.queryOne
    .mockResolvedValueOnce({ org_id: "org-synthetic", location_state: "TX" })
    .mockResolvedValueOnce({ id: "sub-synthetic", org_id: "org-synthetic", company_name: "Synthetic contractor",
      state: "TX", service_area_states: null, email: "estimates@example.invalid", email_verified: true,
      phone: "5125550100", website: "https://example.invalid", license_status: "active", sam_excluded: false,
      google_rating: null, review_count: 0, reviews_summary: null, project_history: [], ...overrides });
}
function verificationWrite() {
  const call = mocks.query.mock.calls.find(([sql]) => String(sql).includes("verification_json=$3"));
  return call ? { sql: call[0], params: call[1], evidence: JSON.parse(call[1][2]) } : null;
}

describe("subcontractor verification continuity", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.query.mockResolvedValue([]);
    mocks.logAgent.mockResolvedValue(undefined);
    mocks.profile.mockResolvedValue({ sub_standards: { min_google_rating: 3.8 } });
    mocks.sam.mockResolvedValue({ excluded: false });
    mocks.callsEnabled.mockResolvedValue(false);
    // A decorated Google rating must not require an AI provider or spend.
    mocks.complete.mockRejectedValue(new Error("AI_UNAVAILABLE: synthetic provider allowance refusal"));
  });

  it.each([{ areas: ["TX"] }, { areas: ["NM", "TX"] }, { areas: [" tx "] }])("keeps the explicit working-state service area through verification: $areas", async ({ areas }) => {
    records({ state: "NM", service_area_states: areas });
    const result = await subVerify.handler(context);
    expect(result).toMatchObject({ ok: true, data: { passes: true, route: "outreach queued" } });
    expect(result.enqueued).toEqual([{ agent: "outreach", payload: context.payload }]);
    expect(mocks.sam).toHaveBeenCalledWith("Synthetic contractor", "org-synthetic");
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.logAgent).not.toHaveBeenCalledWith(expect.objectContaining({ action: "geography-mismatch" }));
    expect(verificationWrite()?.params[4]).toBe("org-synthetic");
  });

  it.each([{ areas: null }, { areas: [] }, { areas: ["NM", "AZ"] }, { areas: ["*"] }, { areas: [null, 123] }])("still rejects an out-of-state firm without explicit coverage: $areas", async ({ areas }) => {
    records({ state: "NM", service_area_states: areas });
    const result = await subVerify.handler(context);
    expect(result.summary).toContain("ruled out");
    expect(result.enqueued ?? []).toEqual([]);
    expect(mocks.sam).not.toHaveBeenCalled();
    expect(mocks.maps).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(verificationWrite()).toBeNull();
  });

  it("records available Google signals without requiring AI or replacing saved review prose", async () => {
    records({ google_rating: 4.7, review_count: 25, reviews_summary: "Previously recorded review summary" });
    const result = await subVerify.handler(context);
    expect(result).toMatchObject({ ok: true, data: { passes: true, route: "outreach queued" } });
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(verificationWrite()?.evidence.google_signal).toEqual({ rating: 4.7, review_count: 25 });
    const subWrite = mocks.query.mock.calls.find(([sql]) => String(sql).includes("update subcontractors"));
    expect(subWrite?.[1][6]).toBe("Previously recorded review summary");
  });

  it("does not turn SAM uncertainty into an outreach pass when AI is unavailable", async () => {
    records({ state: "NM", service_area_states: ["TX"], google_rating: 4.7, review_count: 25 });
    mocks.sam.mockResolvedValue({ excluded: false, error: "synthetic SAM timeout" });
    const result = await subVerify.handler(context);
    expect(result).toMatchObject({ ok: false, humanActionRequired: true, enqueued: [], data: { passes: false } });
    expect(verificationWrite()?.evidence.sam_confirmed).toBe(false);
    expect(verificationWrite()?.params[5]).toBe(false);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it.each([{ rating: 2, excluded: false }, { rating: 4.7, excluded: true }])("retains standards gates for a travelling firm: $rating stars, excluded=$excluded", async ({ rating, excluded }) => {
    records({ state: "NM", service_area_states: ["TX"], google_rating: rating, review_count: 25 });
    mocks.sam.mockResolvedValue({ excluded });
    const result = await subVerify.handler(context);
    expect(result).toMatchObject({ ok: true, enqueued: [], data: { passes: false, route: "held (failed standards)" } });
    const saved = verificationWrite()!;
    expect(saved.params[5]).toBe(true); // Lookup completed, but the firm failed standards.
    const subs = [guideSub({ verified: saved.params[5], verification_json: saved.evidence,
      google_rating: rating, sam_excluded: excluded, has_trade_contact: true })];
    expect(verifiedGuideProgress({ standards: guideStandards, subs,
      sourceEvidence: { analysisInputHash: 'synthetic', completeness: { ok: true, missing: [] } },
      coverage: summarizeTradeCoverage({ requiredTrades: ['Roofing'], subs, quotes: [] })
    })).toMatchObject({ subsFound: false, subsContacted: false });
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("does not promote an unverified email when removing the optional AI summary", async () => {
    records({ email_verified: false, google_rating: 4.7, review_count: 25 });
    const result = await subVerify.handler(context);
    expect(result.enqueued).toEqual([]);
    expect(result.data?.route).toContain("no verified email, calling is off");
    expect(verificationWrite()?.evidence.email_verified).toBe(false);
    expect(mocks.complete).not.toHaveBeenCalled();
  });
});
