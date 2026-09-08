import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveTenantOrgId = vi.fn<() => Promise<string>>();
const orgApiKey = vi.fn<(key: string, orgId: string) => Promise<string>>();
const queryOne = vi.fn(async () => null);

vi.mock("../lib/tenant", () => ({
  resolveTenantOrgId: () => resolveTenantOrgId(),
}));

vi.mock("../lib/integration-keys", () => ({
  orgApiKey: (key: string, orgId: string) => orgApiKey(key, orgId),
}));

vi.mock("../lib/integration-settings", () => ({
  recordIntegrationUse: vi.fn(),
}));

vi.mock("../lib/db", () => ({
  query: vi.fn(async () => []),
  queryOne: (...args: unknown[]) => queryOne(...args),
}));

import { sam } from "../lib/integrations/sam";

describe("SAM tenant scope", () => {
  beforeEach(() => {
    resolveTenantOrgId.mockReset();
    orgApiKey.mockReset();
    queryOne.mockClear();
    resolveTenantOrgId.mockRejectedValue(new Error("No organization context."));
    orgApiKey.mockResolvedValue("tenant-key");
  });

  it("fails closed before resolving a key when no tenant context exists", async () => {
    await expect(sam.enabled()).rejects.toThrow("No organization context");
    expect(orgApiKey).not.toHaveBeenCalled();
  });

  it("uses an explicit organization without consulting ambient tenant state", async () => {
    await expect(sam.enabled(" org-explicit ")).resolves.toBe(true);
    expect(resolveTenantOrgId).not.toHaveBeenCalled();
    expect(orgApiKey).toHaveBeenCalledWith("SAM_API_KEY", "org-explicit");
  });

  it("distinguishes an exhausted quota from a missing key for compliance gates", async () => {
    await expect(sam.isExcluded("Example Contractor", "org-explicit")).resolves.toEqual({
      disabled: true,
      disabledReason: "quota_exhausted",
      excluded: false,
    });
    expect(queryOne).toHaveBeenCalledWith(expect.stringContaining("sam_daily_calls"), [
      "org-explicit",
    ]);
  });
});
