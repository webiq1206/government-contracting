import { describe, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({ evidence: vi.fn(), stored: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn(), queryOne: vi.fn() }));
vi.mock("@/lib/integration-settings", () => ({ listSettings: m.stored }));
vi.mock("@/lib/ai/provider-facts", async original => ({ ...(await original<typeof import("@/lib/ai/provider-facts")>()), currentProviderEvidence: m.evidence }));
import { accountIntegrations } from "@/lib/admin/account-detail";
describe("support sees the current provider credential evidence", () => {
  it("uses environment/platform refusals instead of old saved-key success, without borrowing another provider", async () => {
    m.stored.mockResolvedValue([{ env_key: "ANTHROPIC_API_KEY", value: "synthetic", last_success_at: new Date().toISOString() }]);
    m.evidence.mockImplementation(async (provider: string) => ({ configured: true, source: "platform", facts: provider === "Anthropic" ? {
      last_success_at: null, last_failure_at: new Date(), refusal_reason: "Anthropic rejected the API key", refusal_status: 401,
    } : null }));
    const rows = await accountIntegrations("tenant-a");
    expect(rows.find(r => r.id === "claude")?.verdict.state).toBe("blocked");
    expect(rows.find(r => r.id === "openai")?.verdict.state).toBe("configured");
    expect(m.evidence).toHaveBeenCalledWith("Anthropic", "tenant-a");
    expect(m.evidence).toHaveBeenCalledWith("OpenAI", "tenant-a");
  });
});
