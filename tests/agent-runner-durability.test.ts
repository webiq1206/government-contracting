import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentDefinition } from "@/lib/agents/types";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  logAgent: vi.fn(async () => undefined),
  enqueue: vi.fn(),
  handler: vi.fn(),
}));

vi.mock("@/lib/config", () => ({ config: { worker: { disabledAgents: [] } } }));
vi.mock("@/lib/ai/claude", () => ({ claudeEnabled: vi.fn(async () => true) }));
vi.mock("@/lib/db", () => ({ query: mocks.query, queryOne: mocks.queryOne }));
vi.mock("@/lib/logger", () => ({ logAgent: mocks.logAgent }));
vi.mock("@/lib/app-settings", () => ({
  isPlatformAutomationPaused: vi.fn(async () => false),
  isAutomationPaused: vi.fn(async () => false),
}));
vi.mock("@/lib/pursuit-guard", () => ({ pursuitStatus: vi.fn() }));
vi.mock("@/lib/agents/payload-records", () => ({
  lookupPayloadRecords: vi.fn(async () => []),
  isPermanentlyGone: vi.fn(() => false),
}));
vi.mock("@/lib/queue", () => ({
  enqueue: mocks.enqueue,
  CLOSED_OPPORTUNITY_JOB_KEY: "closedOpportunityJob",
  ENQUEUED_BY_ORG_KEY: "enqueuedByOrgId",
  PURSUIT_VERSION_KEY: "pursuitVersionAtEnqueue",
  RECOVERY_REQUEUE_KEY: "recoveryRequeueId",
}));

const { runAgent, shouldQueueRetry } = await import("@/lib/agents/runner");

const ORG_ID = "11111111-1111-4111-8111-111111111111";

function probe(): AgentDefinition {
  return {
    name: "runner-durability-probe",
    label: "Runner durability probe",
    description: "Exercises the runner without a provider.",
    worksWithoutClaude: true,
    handler: mocks.handler,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue([]);
  mocks.queryOne.mockResolvedValue({ id: "run-1" });
  mocks.enqueue.mockResolvedValue("child-job-1");
  mocks.handler.mockResolvedValue({ ok: true, summary: "Canonical work completed." });
});

describe("agent runner durable failure truth", () => {
  it("does not begin canonical work when the durable run insert throws", async () => {
    mocks.queryOne.mockRejectedValueOnce(new Error("job_runs is unavailable"));

    const result = await runAgent(probe(), "queue", { orgId: ORG_ID });

    expect(mocks.handler).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, humanActionRequired: true });
    expect(result.summary).toContain("durable run record could not be created");
    expect(result.summary).toContain("job_runs is unavailable");
    expect(result.summary).toContain("No agent work was performed");
    expect(shouldQueueRetry(result)).toBe(true);
    expect(mocks.logAgent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "job-run-start-failed", status: "error" })
    );
  });

  it("does not begin canonical work when the insert returns no run id", async () => {
    mocks.queryOne.mockResolvedValueOnce(null);

    const result = await runAgent(probe(), "manual", { orgId: ORG_ID });

    expect(mocks.handler).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("database returned no run identifier");
  });

  it.each([
    {
      name: "returned refusal",
      arrange: () => mocks.enqueue.mockResolvedValueOnce(null),
      reason: "the queue refused this required step",
    },
    {
      name: "thrown queue error",
      arrange: () => mocks.enqueue.mockRejectedValueOnce(new Error("queue connection lost")),
      reason: "queue connection lost",
    },
  ])("persists a $name as failed without replaying completed work", async ({ arrange, reason }) => {
    mocks.handler.mockResolvedValueOnce({
      ok: true,
      summary: "Canonical work completed.",
      enqueued: [{ agent: "required-child", payload: { recordId: "record-1" } }],
    });
    arrange();

    const result = await runAgent(probe(), "queue", { orgId: ORG_ID });

    expect(mocks.handler).toHaveBeenCalledTimes(1);
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: false,
      permanent: true,
      humanActionRequired: true,
    });
    expect(result.summary).toContain(`required-child: ${reason}`);
    expect(shouldQueueRetry(result)).toBe(false);
    expect(mocks.logAgent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "downstream-enqueue-failed", status: "error" })
    );

    const completion = mocks.query.mock.calls.find(([sql]) =>
      String(sql).includes("update job_runs set status")
    );
    expect(completion?.[1]?.[1]).toBe("error");
    expect(completion?.[1]?.[2]).toContain(reason);
  });

  it("does not report success when the final durable status write fails", async () => {
    mocks.query.mockRejectedValueOnce(new Error("job_runs update failed"));

    const result = await runAgent(probe(), "queue", { orgId: ORG_ID });

    expect(mocks.handler).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: false,
      permanent: true,
      humanActionRequired: true,
    });
    expect(result.summary).toContain("could not record the final run status");
    expect(result.summary).toContain("job_runs update failed");
    expect(shouldQueueRetry(result)).toBe(false);
    expect(mocks.logAgent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "job-run-finish-failed", status: "error" })
    );
  });

  it("keeps the healthy result when the child queue and durable write succeed", async () => {
    mocks.handler.mockResolvedValueOnce({
      ok: true,
      summary: "Canonical work completed.",
      enqueued: [{ agent: "required-child", payload: {} }],
    });

    const result = await runAgent(probe(), "queue", { orgId: ORG_ID });

    expect(result.ok).toBe(true);
    expect(result.humanActionRequired).toBeUndefined();
    const completion = mocks.query.mock.calls.find(([sql]) =>
      String(sql).includes("update job_runs set status")
    );
    expect(completion?.[1]?.[1]).toBe("ok");
  });
});
