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
});
