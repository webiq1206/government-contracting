import { describe, expect, it, vi } from "vitest";
vi.mock("../lib/db", () => ({ query: vi.fn(), queryOne: vi.fn() }));
import { providerCapacityState } from "../lib/admin/platform-health";
import { serviceStatuses } from "../lib/domain/platform-health";

describe("provider capacity requires evidence", () => {
  it("does not turn an empty failure sample into a working connection", () => {
    const providerCapacity = providerCapacityState([]);
    expect(providerCapacity.state).toBe("unknown");
    const row = serviceStatuses([], { providerCapacity, billingWebhooks: {state: "unknown", detail: ""}, queueDepth: null }).find(row => row.key === "provider_capacity");
    expect(row?.stateWord).toBe("Not verified");
  });
  it("retains a recorded credit blocker", () => {
    const result = providerCapacityState([{agent: "scoring-engine", orgId: "example", at: "2026-09-09T12:00:00Z", error: "credit balance too low"}]);
    expect(result.state).toBe("down");
    expect(result.detail).toContain("credit");
  });
  it.each([
    ["backlink-scout", "Ahrefs could not return live data (API_BUDGET: price ceiling required). Check the API key, plan quota, and provider status"],
    ["solicitation-analyst", "API_BUDGET: Your daily allowance cannot cover another request"],
    ["backlink-scout", "401 Unauthorized for Ahrefs"],
    ["reply-poll", "Gmail 403 quota exceeded"],
  ])("does not report %s spending or non-AI failures as AI outages", (agent, error) => {
    expect(providerCapacityState([{ agent, orgId: "org", at: "2026-09-23T12:00:00Z", error }]).state).toBe("unknown");
  });
  it("keeps an actual AI authentication refusal visible", () => {
    expect(providerCapacityState([{ agent: "solicitation-analyst", orgId: "org", at: "2026-09-23T12:00:00Z", error: "OpenAI 401 Unauthorized" }]).state).toBe("down");
  });
});
