import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hydrate: vi.fn(),
  integrationStatus: vi.fn(),
  orgIntegrationStatus: vi.fn(),
  listSettings: vi.fn(),
  inbox: vi.fn(),
  rulesReviewed: vi.fn(),
  getRules: vi.fn(),
  query: vi.fn(),
  resolveOrg: vi.fn(),
}));

vi.mock("@/lib/config", () => ({ integrationStatus: mocks.integrationStatus }));
vi.mock("@/lib/integration-keys", () => ({
  orgIntegrationStatus: mocks.orgIntegrationStatus,
}));
vi.mock("@/lib/integration-settings", () => ({
  hydrateIntegrationEnv: mocks.hydrate,
  listSettings: mocks.listSettings,
}));
vi.mock("@/lib/integrations/gmail", () => ({
  gmail: { connection: mocks.inbox },
}));
vi.mock("@/lib/app-settings", () => ({
  rulesReviewed: mocks.rulesReviewed,
  getAutomationRules: mocks.getRules,
}));
vi.mock("@/lib/db", () => ({ query: mocks.query }));
vi.mock("@/lib/tenant", () => ({ resolveTenantOrgId: mocks.resolveOrg }));

import { accountSetup } from "@/lib/setup-facts";

const ORG = "11111111-1111-4111-8111-111111111111";

function successfulDefaults() {
  mocks.hydrate.mockResolvedValue(undefined);
  mocks.integrationStatus.mockReturnValue({
    gmail: true,
    sam: true,
    claude: true,
    googleMaps: true,
  });
  mocks.orgIntegrationStatus.mockResolvedValue({
    sam: false,
    claude: false,
    googleMaps: false,
    hunter: false,
    ahrefs: false,
    twilio: false,
  });
  mocks.listSettings.mockResolvedValue([]);
  mocks.inbox.mockResolvedValue({ connected: false });
  mocks.rulesReviewed.mockResolvedValue(false);
  mocks.getRules.mockResolvedValue({ outreach_batch_limit: 5, followup_hours: 48 });
  mocks.resolveOrg.mockResolvedValue(ORG);
  mocks.query.mockResolvedValue([
    { opportunities: "0", scored: "0", outreach: "0" },
  ]);
}

describe("account setup read truth", () => {
  beforeEach(() => {
    for (const fn of Object.values(mocks)) fn.mockReset();
    successfulDefaults();
  });

  it("keeps a legitimate empty account distinct from a failed count", async () => {
    const setup = await accountSetup(null, null);

    expect(setup.warnings).toEqual([]);
    expect(setup.items.find((item) => item.key === "first_opportunity")?.hint).not.toBe(
      "Not counted yet."
    );
  });

  it("surfaces every failed setup source and does not borrow deployment-key status", async () => {
    mocks.orgIntegrationStatus.mockRejectedValueOnce(new Error("keys unavailable"));
    mocks.inbox.mockRejectedValueOnce(new Error("inbox unavailable"));
    mocks.listSettings.mockRejectedValueOnce(new Error("history unavailable"));
    mocks.rulesReviewed.mockRejectedValueOnce(new Error("rules unavailable"));
    mocks.getRules.mockRejectedValueOnce(new Error("limits unavailable"));
    mocks.query.mockRejectedValueOnce(new Error("counts unavailable"));

    const setup = await accountSetup(null, null);

    expect(setup.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("connection status could not be verified"),
        expect.stringContaining("connected inbox could not be verified"),
        expect.stringContaining("Credential test history could not be loaded"),
        expect.stringContaining("rules were reviewed could not be checked"),
        expect.stringContaining("contact limits could not be loaded"),
        expect.stringContaining("pipeline totals could not be counted"),
      ])
    );
    expect(setup.items.find((item) => item.key === "sam")?.done).toBe(false);
    expect(setup.items.find((item) => item.key === "claude")?.done).toBe(false);
    expect(setup.items.find((item) => item.key === "googleMaps")?.done).toBe(false);
    expect(setup.items.find((item) => item.key === "email")?.done).toBe(false);
    expect(setup.items.find((item) => item.key === "first_opportunity")?.hint).toBe(
      "Not counted yet."
    );
    expect(setup.complete).toBe(false);
  });
});
