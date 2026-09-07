import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  logAgent: vi.fn(),
  getProfileJson: vi.fn(),
  placeDetails: vi.fn(),
  domainSearch: vi.fn(),
  findEmail: vi.fn(),
  verifyEmail: vi.fn(),
  scrapeWebsiteEmail: vi.fn(),
  domainHasMx: vi.fn(),
  findWebsiteBysearch: vi.fn(),
  samExcluded: vi.fn(),
  areCallsEnabled: vi.fn(),
  findContact: vi.fn(),
  ahrefsConfiguration: vi.fn(),
  authoritySnapshot: vi.fn(),
  referringDomains: vi.fn(),
  organicCompetitors: vi.fn(),
  brokenBacklinks: vi.fn(),
}));

vi.mock("../lib/db", () => ({ query: mocks.query, queryOne: mocks.queryOne }));
vi.mock("../lib/logger", () => ({ logAgent: mocks.logAgent }));
vi.mock("../lib/ai/companyProfile", () => ({ getProfileJson: mocks.getProfileJson }));
vi.mock("../lib/ai/claude", () => ({
  ClaudeNotConfiguredError: class ClaudeNotConfiguredError extends Error {},
  complete: vi.fn(),
}));
vi.mock("../lib/integrations/googleMaps", () => ({
  googleMaps: { placeDetails: mocks.placeDetails },
}));
vi.mock("../lib/integrations/hunter", () => ({
  hunter: {
    domainSearch: mocks.domainSearch,
    findEmail: mocks.findEmail,
    verifyEmail: mocks.verifyEmail,
  },
}));
vi.mock("../lib/integrations/email-scrape", () => ({
  scrapeWebsiteEmail: mocks.scrapeWebsiteEmail,
  domainHasMx: mocks.domainHasMx,
}));
vi.mock("../lib/integrations/website-finder", () => ({
  findWebsiteBysearch: mocks.findWebsiteBysearch,
}));
vi.mock("../lib/integrations/sam", () => ({
  sam: { isExcluded: mocks.samExcluded },
}));
vi.mock("../lib/app-settings", () => ({ areCallsEnabled: mocks.areCallsEnabled }));
vi.mock("../lib/integrations/contact-finder", () => ({ findContact: mocks.findContact }));
vi.mock("../lib/integrations/ahrefs", () => ({
  ahrefs: {
    configuration: mocks.ahrefsConfiguration,
    authoritySnapshot: mocks.authoritySnapshot,
    referringDomains: mocks.referringDomains,
    organicCompetitors: mocks.organicCompetitors,
    brokenBacklinks: mocks.brokenBacklinks,
  },
}));
vi.mock("../lib/tenant-context", () => ({
  LEGACY_ORG_ID: "org-platform",
  currentOrgId: () => "org-a",
  runWithOrg: (_orgId: string, fn: () => unknown) => fn(),
}));

import { subVerify } from "../lib/agents/sub-verify";
import { backlinkScout } from "../lib/agents/backlink-scout";

const context = {
  runId: "run-1",
  trigger: "queue" as const,
  payload: { opportunityId: "opp-1", subcontractorId: "sub-1", trade: "roofing" },
};

describe("verification agent failure truth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue([]);
    mocks.logAgent.mockResolvedValue(undefined);
    mocks.getProfileJson.mockResolvedValue(null);
    mocks.placeDetails.mockResolvedValue(null);
    mocks.domainSearch.mockResolvedValue({ emails: [], error: "provider timeout" });
    mocks.findEmail.mockResolvedValue({ disabled: true });
    mocks.verifyEmail.mockResolvedValue({ disabled: true });
    mocks.scrapeWebsiteEmail.mockRejectedValue(new Error("site timeout"));
    mocks.domainHasMx.mockResolvedValue(false);
    mocks.findWebsiteBysearch.mockResolvedValue(null);
    mocks.samExcluded.mockResolvedValue({ excluded: false });
    mocks.areCallsEnabled.mockResolvedValue(false);
  });

  it("stops before every provider when opportunity and subcontractor tenants differ", async () => {
    mocks.queryOne
      .mockResolvedValueOnce({ org_id: "org-a", location_state: "TX" })
      .mockResolvedValueOnce(null);

    const result = await subVerify.handler(context);

    expect(result).toMatchObject({ ok: false, humanActionRequired: true });
    expect(mocks.placeDetails).not.toHaveBeenCalled();
    expect(mocks.findWebsiteBysearch).not.toHaveBeenCalled();
    expect(mocks.domainSearch).not.toHaveBeenCalled();
    expect(mocks.scrapeWebsiteEmail).not.toHaveBeenCalled();
    expect(mocks.samExcluded).not.toHaveBeenCalled();
  });

  it("holds downstream work and exposes provider failures while scoping every write", async () => {
    mocks.queryOne
      .mockResolvedValueOnce({ org_id: "org-a", location_state: "TX" })
      .mockResolvedValueOnce({
        id: "sub-1",
        org_id: "org-a",
        company_name: "Acme Roofing",
        website: "https://acme.example",
        email: null,
        email_verified: false,
        phone: null,
        state: "TX",
        license_status: "active",
        sam_excluded: false,
        project_history: [],
      });

    const result = await subVerify.handler(context);

    expect(result.ok).toBe(false);
    expect(result.humanActionRequired).toBe(true);
    expect(result.enqueued).toEqual([]);
    expect(result.summary).toContain("Verification is incomplete");
    expect(result.data?.unresolvedFailures).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Hunter domain search failed"),
        expect.stringContaining("Website email crawl failed"),
      ])
    );
    expect(mocks.logAgent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "website-email-error", status: "error" })
    );

    const updates = mocks.query.mock.calls
      .map(([sql]) => String(sql).replace(/\s+/g, " ").trim())
      .filter((sql) => /^update /i.test(sql));
    expect(updates.length).toBeGreaterThan(0);
    for (const sql of updates) expect(sql).toContain("org_id");
  });

  it("treats a null website search as inconclusive instead of proving no website exists", async () => {
    mocks.queryOne
      .mockResolvedValueOnce({ org_id: "org-a", location_state: "TX" })
      .mockResolvedValueOnce({
        id: "sub-1",
        org_id: "org-a",
        company_name: "Acme Roofing",
        website: null,
        email: null,
        email_verified: false,
        phone: null,
        state: "TX",
        license_status: "active",
        sam_excluded: false,
        project_history: [],
      });

    const result = await subVerify.handler(context);

    expect(result).toMatchObject({ ok: false, humanActionRequired: true, enqueued: [] });
    expect(result.summary).toContain("Web-search website lookup was inconclusive");
    const subWrite = mocks.query.mock.calls.find(([sql]) =>
      String(sql).includes("update subcontractors")
    );
    expect(subWrite?.[1]?.[9]).toBe("discovery_incomplete");
  });

  it("reports an unreadable backlink contact crawl as a failed partial run", async () => {
    mocks.ahrefsConfiguration.mockResolvedValue({ enabled: true, target: "brostco.com" });
    mocks.authoritySnapshot.mockResolvedValue(null);
    mocks.referringDomains.mockResolvedValue({ items: [] });
    mocks.organicCompetitors.mockResolvedValue({ items: [] });
    mocks.brokenBacklinks.mockResolvedValue({ items: [] });
    mocks.findContact.mockResolvedValue({
      email: null,
      emails: [],
      contactForm: null,
      checkedPages: 0,
    });
    mocks.query.mockImplementation(async (sql: string) =>
      sql.includes("select id, domain, contact_json from backlink_prospects")
        ? [{ id: "prospect-1", domain: "unavailable.example", contact_json: null }]
        : []
    );

    const result = await backlinkScout.handler({
      runId: "run-2",
      trigger: "cron",
      payload: {},
    });

    expect(result).toMatchObject({ ok: false, humanActionRequired: true });
    expect(result.data).toMatchObject({
      contactFailures: 1,
      failedContactDomains: ["unavailable.example"],
    });
    expect(mocks.logAgent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "scan", level: "error", status: "error" })
    );
    const failureWrite = mocks.query.mock.calls.find(([, params]) =>
      Array.isArray(params) &&
      params.some(
        (value) =>
          typeof value === "string" && value.includes('"contact_discovery_status":"failed"')
      )
    );
    expect(failureWrite).toBeDefined();
    expect(failureWrite?.[0]).toContain("org_id = $3");
    expect(failureWrite?.[1]).toEqual(
      expect.arrayContaining([expect.stringContaining('"contact_discovery_status":"failed"')])
    );
  });
});
