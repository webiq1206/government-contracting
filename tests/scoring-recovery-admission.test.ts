import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), enqueue: vi.fn(), log: vi.fn() }));
vi.mock("../lib/db", () => ({ query: mocks.query, queryOne: vi.fn(), transaction: vi.fn() }));
vi.mock("../lib/queue", () => ({ enqueue: mocks.enqueue }));
vi.mock("../lib/logger", () => ({ logAgent: mocks.log }));
vi.mock("../lib/organizations", () => ({ listActiveOrganizations: async () => [{ id: "tenant-a" }] }));
import { scoringRecoverySweep } from "../lib/agents/maintenance";
describe("recovery sweep admission outcomes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.query.mockImplementation(async (sql: string) => sql.includes("solicitation_analysis is null") ? [{ id: "analysis-1" }] : [{ id: "score-1", title: "Unscored" }]);
  });
  const run = () => scoringRecoverySweep.handler({ runId: "test", trigger: "cron", payload: {} });
  it("leaves duplicate or safety-deferred jobs pending without inventing a queue outage", async () => {
    mocks.enqueue.mockResolvedValue(null);
    const result = await run();
    expect(result.data).toMatchObject({ deferred: 2, scoringQueued: 0, analysisQueued: 0, queueFailures: 0 });
    expect(result.summary).toContain("deferred");
    expect(result.summary).not.toContain("Nothing to recover");
    expect(mocks.log.mock.calls.flat().some((entry: { level?: string }) => entry.level === "error")).toBe(false);
  });
  it("keeps actual backend failures visible while counting only confirmed admissions", async () => {
    mocks.enqueue.mockResolvedValueOnce("job-1").mockRejectedValueOnce(new Error("database unavailable"));
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.humanActionRequired).toBe(true);
    expect(result.data).toMatchObject({ deferred: 0, scoringQueued: 1, analysisQueued: 0, queueFailures: 1 });
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ level: "error", message: expect.stringContaining("database unavailable") }));
  });
});
