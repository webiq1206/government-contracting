import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ key: vi.fn(), identity: vi.fn(), admission: vi.fn() }));
vi.mock("../lib/integration-keys", () => ({ orgApiKey: mocks.key }));
vi.mock("../lib/api-usage/ledger", () => ({
  requestIdentity: mocks.identity, beginUsage: mocks.admission,
  ApiUsageBlockedError: class extends Error {},
}));
import { checkClaudeSpending } from "../lib/api-usage/check-spending";
import { config } from "../lib/config";
describe("analysis spending preflight", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.key.mockResolvedValue("test-key"); mocks.identity.mockResolvedValue({ orgId: "tenant-a" }); });
  it("checks the selected tenant and exact complex model without reserving or calling a provider", async () => {
    await checkClaudeSpending("tenant-a", "complex-test-model", "solicitation-analyst");
    expect(mocks.key).toHaveBeenCalledWith("ANTHROPIC_API_KEY", "tenant-a");
    expect(mocks.identity).toHaveBeenCalledWith("ANTHROPIC_API_KEY", "test-key", "tenant-a");
    expect(mocks.admission).toHaveBeenCalledWith({ orgId: "tenant-a" }, "Anthropic", "complex-test-model", "solicitation-analyst", { dryRun: true, complex: true });
  });
  it("does not treat routine work as complex and propagates a spending hold", async () => {
    const hold = new Error("API_BUDGET: spending paused"); mocks.admission.mockRejectedValue(hold);
    await expect(checkClaudeSpending("tenant-a", config.claude.model, "routine")).rejects.toBe(hold);
    expect(mocks.admission.mock.calls[0][4]).toEqual({ dryRun: true, complex: false });
  });
  it("stops before admission if the tenant has no connected key", async () => {
    mocks.key.mockResolvedValue(null);
    await expect(checkClaudeSpending("tenant-a", config.claude.model, "routine")).rejects.toThrow("not connected");
    expect(mocks.admission).not.toHaveBeenCalled();
  });
});
