import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ queryOne: vi.fn(), enqueue: vi.fn(), rules: vi.fn() }));
vi.mock("../lib/db", () => ({ query: vi.fn(), queryOne: m.queryOne }));
vi.mock("../lib/queue", () => ({ enqueue: m.enqueue }));
vi.mock("../lib/app-settings", () => ({ getAutomationRules: m.rules, areCallsEnabled: async () => true, getWorkExecution: async () => "sub" }));

import { queueNextCandidate } from "../lib/agents/sub-verify";

const input = { orgId: "org", opportunityId: "opp", trade: "HVAC", verifyTopN: 5 };

describe("a verification miss is replaced by the next ranked candidate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.rules.mockResolvedValue({ rfq_subs_per_trade: 5 });
    m.enqueue.mockResolvedValue("job");
  });

  it("checks the candidate ranked just past the initial batch for the first miss, and the next for the second", async () => {
    m.queryOne.mockResolvedValueOnce({ emailable: 1, misses: 1 }).mockResolvedValueOnce({ subcontractor_id: "rank-6" });
    expect(await queueNextCandidate(input)).toBe("rank-6");
    expect(m.queryOne.mock.calls[1][1]).toEqual(["opp", "HVAC", "org", 5]);
    expect(m.enqueue).toHaveBeenCalledWith("sub-verify", { opportunityId: "opp", subcontractorId: "rank-6", trade: "HVAC" },
      expect.objectContaining({ singletonKey: "verify:opp:rank-6:HVAC", orgId: "org" }));

    m.queryOne.mockResolvedValueOnce({ emailable: 1, misses: 2 }).mockResolvedValueOnce({ subcontractor_id: "rank-7" });
    expect(await queueNextCandidate(input)).toBe("rank-7");
    expect(m.queryOne.mock.calls[3][1]).toEqual(["opp", "HVAC", "org", 6]);
  });

  it("stops once the trade has as many emailable firms as it may be sent", async () => {
    m.queryOne.mockResolvedValueOnce({ emailable: 5, misses: 3 });
    expect(await queueNextCandidate(input)).toBeNull();
    expect(m.enqueue).not.toHaveBeenCalled();
  });

  it("stops when the ranked list runs out, and ignores a duplicate already queued", async () => {
    m.queryOne.mockResolvedValueOnce({ emailable: 0, misses: 9 }).mockResolvedValueOnce(null);
    expect(await queueNextCandidate(input)).toBeNull();
    m.queryOne.mockResolvedValueOnce({ emailable: 0, misses: 1 }).mockResolvedValueOnce({ subcontractor_id: "rank-6" });
    m.enqueue.mockResolvedValueOnce(null);
    expect(await queueNextCandidate(input)).toBeNull();
  });
});
