import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn(async () => []);
const queryOne = vi.fn();
const logAgent = vi.fn(async () => undefined);

vi.mock("../lib/db", () => ({
  query: (...args: unknown[]) => query(...args),
  queryOne: (...args: unknown[]) => queryOne(...args),
  transaction: vi.fn(),
}));

vi.mock("../lib/logger", () => ({
  logAgent: (...args: unknown[]) => logAgent(...args),
}));

import { scoringEngine } from "../lib/agents/scoring-engine";
import { solicitationAnalyst } from "../lib/agents/solicitation-analyst";
import { subFinder } from "../lib/agents/sub-finder";

const orphan = {
  id: "opp-orphan",
  org_id: null,
  source: "sam_federal",
  stage: "scoring",
  status: "open",
};

describe("SAM pipeline orphan ownership", () => {
  beforeEach(() => {
    query.mockClear();
    queryOne.mockReset();
    logAgent.mockClear();
    queryOne.mockResolvedValue(orphan);
  });

  it.each([
    ["scoring", scoringEngine],
    ["analysis", solicitationAnalyst],
    ["subcontractor discovery", subFinder],
  ])("refuses %s instead of attributing it to a default tenant", async (_label, agent) => {
    const result = await agent.handler({
      runId: "run-1",
      trigger: "queue",
      payload: { opportunityId: orphan.id },
    });
    expect(result.ok).toBe(false);
    expect(result.humanActionRequired).toBe(true);
    expect(result.summary).toMatch(/organization owner|tenant ownership/i);
    expect(logAgent).toHaveBeenCalledWith(
      expect.objectContaining({ opportunityId: orphan.id, status: "error" })
    );
    expect(query).not.toHaveBeenCalled();
  });
});
