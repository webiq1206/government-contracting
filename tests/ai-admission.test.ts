/**
 * The queue asks the spending ledger before creating paid AI work.
 *
 * While an allowance is exhausted, the state-driven sweeps re-create the
 * same analysis job every fifteen minutes; each one used to run, be refused
 * before it cost anything, and be logged as a failure. Asking once, before
 * the job exists, is what turns seven hundred daily "failures" into nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  check: vi.fn(async (_org: string, _tier: string, _feature: string) => undefined as unknown),
  agents: new Map<string, { name: string; worksWithoutClaude?: boolean; aiTier?: "routine" | "complex" }>(),
}));

vi.mock("@/lib/agents/registry", () => ({
  getAgent: (name: string) => mocks.agents.get(name),
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithOrg: async <T,>(_org: string, fn: () => Promise<T>) => fn(),
}));
vi.mock("@/lib/api-usage/check-spending", () => ({
  checkAiSpending: mocks.check,
}));

const { aiEnqueueHold, clearAiAdmissionMemo, holdReason } = await import("@/lib/queue/ai-admission");

const ORG = "11111111-1111-4111-8111-111111111111";
const blocked = (message: string) => Object.assign(new Error(message), { name: "ApiUsageBlockedError" });

beforeEach(() => {
  vi.clearAllMocks();
  clearAiAdmissionMemo();
  mocks.agents.clear();
  mocks.agents.set("solicitation-analyst", { name: "solicitation-analyst", worksWithoutClaude: false, aiTier: "complex" });
  mocks.agents.set("scoring-engine", { name: "scoring-engine", worksWithoutClaude: true });
  mocks.check.mockResolvedValue(undefined);
});

describe("aiEnqueueHold", () => {
  it("never holds an agent that runs without AI, and never asks about it", async () => {
    expect(await aiEnqueueHold("scoring-engine", ORG)).toBeNull();
    expect(mocks.check).not.toHaveBeenCalled();
  });

  it("never holds work with no organization to charge", async () => {
    expect(await aiEnqueueHold("solicitation-analyst", null)).toBeNull();
    expect(mocks.check).not.toHaveBeenCalled();
  });

  it("returns the ledger's reason for an agent whose tier is refused", async () => {
    mocks.check.mockRejectedValueOnce(blocked("API_BUDGET: Your daily allowance cannot cover another request."));
    const hold = await aiEnqueueHold("solicitation-analyst", ORG);
    expect(hold).toContain("daily allowance");
    expect(mocks.check).toHaveBeenCalledWith(ORG, "complex", "solicitation-analyst");
    expect(holdReason(hold!)).toBe("Your daily allowance cannot cover another request.");
  });

  it("asks once per organization and tier, not once per job", async () => {
    mocks.check.mockRejectedValue(blocked("API_BUDGET: held"));
    for (let i = 0; i < 200; i++) expect(await aiEnqueueHold("solicitation-analyst", ORG)).toBe("API_BUDGET: held");
    expect(mocks.check).toHaveBeenCalledTimes(1);
  });

  it("does not turn an unrelated lookup failure into a hold", async () => {
    // Dropping work because a lookup broke would hide the real fault; the run
    // reports it instead.
    mocks.check.mockRejectedValueOnce(new Error("connection refused"));
    expect(await aiEnqueueHold("solicitation-analyst", ORG)).toBeNull();
  });

  it("does not hold on a missing AI connection, which the run must report itself", async () => {
    // Same typed error, different meaning: a setup problem, not a budget. A
    // manual run of an unconnected account must still reach the runner.
    mocks.check.mockRejectedValueOnce(
      blocked("AI is not connected. Analysis is waiting. Open Settings, Integrations to complete setup.")
    );
    expect(await aiEnqueueHold("solicitation-analyst", ORG)).toBeNull();
  });

  it("admits work once the allowance allows it", async () => {
    expect(await aiEnqueueHold("solicitation-analyst", ORG)).toBeNull();
  });
});
