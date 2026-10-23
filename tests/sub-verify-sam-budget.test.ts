import { syntheticFit } from "./helpers/subcontractor-fit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(), queryOne: vi.fn(), logAgent: vi.fn(), profile: vi.fn(),
  sam: vi.fn(), maps: vi.fn(), hunterSearch: vi.fn(), hunterFind: vi.fn(), hunterVerify: vi.fn(),
  scrape: vi.fn(), mx: vi.fn(), websiteSearch: vi.fn(), callsEnabled: vi.fn(), enqueue: vi.fn(),
}));
vi.mock("../lib/db", () => ({ query: mocks.query, queryOne: mocks.queryOne }));
vi.mock("../lib/logger", () => ({ logAgent: mocks.logAgent }));
vi.mock("../lib/ai/companyProfile", () => ({ getProfileJson: mocks.profile }));
vi.mock("../lib/ai/claude", () => ({ complete: vi.fn(), ClaudeNotConfiguredError: class extends Error {} }));
vi.mock("../lib/integrations/sam", () => ({ sam: { isExcluded: mocks.sam } }));
vi.mock("../lib/integrations/googleMaps", () => ({ googleMaps: { placeDetails: mocks.maps } }));
vi.mock("../lib/integrations/hunter", () => ({ hunter: {
  domainSearch: mocks.hunterSearch, findEmail: mocks.hunterFind, verifyEmail: mocks.hunterVerify,
} }));
vi.mock("../lib/integrations/email-scrape", () => ({ scrapeWebsiteEmailDetailed: mocks.scrape, domainHasMx: mocks.mx }));
vi.mock("../lib/integrations/website-finder", () => ({ findWebsiteBysearch: mocks.websiteSearch }));
vi.mock("../lib/app-settings", () => ({ getWorkExecution: async () => "sub", areCallsEnabled: mocks.callsEnabled,
  getAutomationRules: async () => ({ rfq_subs_per_trade: 5 }) }));
vi.mock("../lib/tenant-context", () => ({ currentOrgId: () => "org-synthetic" }));
vi.mock("../lib/public-contact-backfill", () => ({ backfillPublicContact: vi.fn() }));
vi.mock("../lib/queue", () => ({ enqueue: mocks.enqueue }));

import { subVerify } from "../lib/agents/sub-verify";

const context = { runId: "synthetic-run", trigger: "queue" as const,
  payload: { opportunityId: "opp-synthetic", subcontractorId: "sub-synthetic", trade: "Electrical" } };
const SAM_REUSE = "verification_json->>'sam_checked_at'";

const fitOpp={id:"opp-synthetic",org_id:"org-synthetic",location_state:"TX",solicitation_analysis:{trade_scopes:[{trade:"Electrical",work:"Install and test the synthetic electrical scope."}]}};
function records(sub: Record<string, unknown>, recentSam: unknown = null) {
  mocks.queryOne.mockImplementation(async (sql: string) => {
    if(String(sql).includes("select verification_json,outreach_state"))return {verification_json:syntheticFit(fitOpp,"sub-synthetic","Electrical")};
    if (String(sql).includes(SAM_REUSE)) return recentSam;
    if (String(sql).includes("count(*) filter")) return { emailable: 0, misses: 1 };
    if (String(sql).includes("offset $4")) return null;
    return undefined;
  });
  mocks.queryOne
    .mockResolvedValueOnce(fitOpp)
    .mockResolvedValueOnce({ id: "sub-synthetic", org_id: "org-synthetic", company_name: "Synthetic contractor",
      state: "TX", service_area_states: null, phone: "5125550100", website: "https://firm.invalid",
      license_status: "active", sam_excluded: false, google_rating: null, review_count: 0,
      reviews_summary: null, project_history: [], ...sub });
}
const verification = () => {
  const call = mocks.query.mock.calls.find(([sql]) => String(sql).includes("set verified=$6"));
  return call ? JSON.parse(call[1][2]) : null;
};
const parked = () => mocks.query.mock.calls.some(([sql]) => String(sql).includes("set human_action_required = true"));

describe("verification spends SAM's daily allowance once per firm, and never on a retry loop", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.query.mockResolvedValue([]);
    mocks.profile.mockResolvedValue({ sub_standards: {} });
    mocks.hunterSearch.mockResolvedValue({ disabled: true });
    mocks.hunterFind.mockResolvedValue({ disabled: true });
    mocks.hunterVerify.mockResolvedValue({ disabled: true });
    mocks.callsEnabled.mockResolvedValue(true);
    mocks.sam.mockResolvedValue({ excluded: false });
    mocks.enqueue.mockResolvedValue(null);
  });

  it("treats a site that was read and publishes no email as an answer, not a failure to retry", async () => {
    records({ email: null, email_verified: false });
    mocks.scrape.mockResolvedValue({ email: null, pagesRead: 3 });
    const result = await subVerify.handler(context);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ route: "call queued (phone only, no verified email)", unresolvedFailures: [] });
  });

  it("still calls an unreadable site inconclusive", async () => {
    records({ email: null, email_verified: false });
    mocks.scrape.mockResolvedValue({ email: null, pagesRead: 0 });
    const result = await subVerify.handler(context);
    expect(result.ok).toBe(false);
    expect((result.data as { unresolvedFailures: string[] }).unresolvedFailures[0]).toMatch(/could not read/);
  });

  it("reuses a confirmed SAM result from the last 30 days instead of asking again", async () => {
    records({ email: "bids@firm.invalid", email_verified: true }, { excluded: false, checked_at: "2026-10-01T00:00:00.000Z" });
    const result = await subVerify.handler(context);
    expect(mocks.sam).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({ route: "outreach queued" });
    // The original lookup date travels with it, so reuse never extends itself.
    expect(verification()).toMatchObject({ sam_confirmed: true, sam_checked_at: "2026-10-01T00:00:00.000Z" });
  });

  it("records the date of a fresh SAM lookup", async () => {
    records({ email: "bids@firm.invalid", email_verified: true });
    await subVerify.handler(context);
    expect(mocks.sam).toHaveBeenCalledTimes(1);
    expect(verification()?.sam_checked_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("waits for SAM's allowance to reset instead of retrying or parking the bid", async () => {
    records({ email: "bids@firm.invalid", email_verified: true });
    mocks.sam.mockResolvedValue({ disabled: true, disabledReason: "quota_exhausted", excluded: false });
    const result = await subVerify.handler(context);
    expect(result.ok).toBe(true);
    expect(result.humanActionRequired).toBe(false);
    expect(parked()).toBe(false);
    expect(result.enqueued).toEqual([expect.objectContaining({
      agent: "sub-verify", payload: context.payload,
      opts: expect.objectContaining({ startAfterSeconds: expect.any(Number), singletonKey: "verify-after-sam-reset:opp-synthetic:sub-synthetic:Electrical" }),
    })]);
    expect((result.enqueued?.[0].opts as { startAfterSeconds: number }).startAfterSeconds).toBeGreaterThanOrEqual(360);
    // Checking another candidate now would only wait as well.
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
