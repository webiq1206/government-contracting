import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentDefinition } from "@/lib/agents/types";

const m = vi.hoisted(() => ({
  research: true,
  stage: "analysis",
  query: vi.fn(),
  queryOne: vi.fn(),
  backendEnqueue: vi.fn(async () => "synthetic-job"),
  handler: vi.fn(async () => ({ ok: true, summary: "Synthetic work completed." })),
  log: vi.fn(async () => undefined),
}));
const ORG = "11111111-1111-4111-8111-111111111111";
const OPP = "22222222-2222-4222-8222-222222222222";

vi.mock("@/lib/config", () => ({ config: { worker: { disabledAgents: [] }, queue: { backend: "pgboss" } } }));
vi.mock("@/lib/db", () => ({ query: m.query, queryOne: m.queryOne, transaction: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logAgent: m.log }));
vi.mock("@/lib/app-settings", () => ({
  isAutomationStopped: async () => false,
  isAutomationPaused: async () => false,
  isPlatformAutomationPaused: async () => false,
  areCallsEnabled: async () => true,
  AUTOMATION_PAUSED_ERROR: "paused",
}));
vi.mock("@/lib/tenant-context", () => ({
  actingOrgId: async () => "11111111-1111-4111-8111-111111111111",
  runWithOrg: (_org: string, fn: () => unknown) => fn(),
}));
vi.mock("@/lib/org-guard", () => ({
  requireOrgContext: async () => ({ orgId: "11111111-1111-4111-8111-111111111111", user: { email: "operator@example.test" } }),
}));
vi.mock("@/lib/api-auth", () => ({
  requireCapability: async () => ({ organizationId: "11111111-1111-4111-8111-111111111111", email: "operator@example.test" }),
}));
vi.mock("@/lib/platform-admin", () => ({ isPlatformAdmin: () => false }));
vi.mock("@/lib/agents/registry", () => ({
  getAgent: (name: string) => ({ name, worksWithoutClaude: true, handler: m.handler }),
}));
vi.mock("@/lib/queue/ai-admission", () => ({ aiEnqueueHold: async () => null, holdReason: (text: string) => text }));
vi.mock("@/lib/ai/claude", () => ({ claudeEnabled: async () => true }));
vi.mock("@/lib/work-mode", () => ({ opportunityOutreachAllowed: async () => true }));
vi.mock("@/lib/queue/pgboss", () => ({ createPgBossQueue: async () => ({
  start: async () => undefined, stop: async () => undefined, enqueue: m.backendEnqueue,
}) }));

import { enqueue, PURSUIT_VERSION_KEY } from "@/lib/queue";
import { runAgent, shouldQueueRetry } from "@/lib/agents/runner";
import { POST as action } from "@/app/api/opportunities/[id]/action/route";
import { POST as manualRun } from "@/app/api/agents/[name]/run/route";

const request = (body: unknown) => new Request("http://local.test", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
const definition = (name: string): AgentDefinition => ({
  name, label: name, description: "Synthetic guard probe", worksWithoutClaude: true, handler: m.handler,
});

beforeEach(() => {
  vi.clearAllMocks();
  m.research = true;
  m.stage = "analysis";
  m.query.mockResolvedValue([{ id: OPP }]);
  m.queryOne.mockImplementation(async (sql: string) => {
    if (sql.includes("insert into job_runs")) return { id: "synthetic-run" };
    if (sql.includes("select org_id from opportunities")) return { org_id: ORG };
    if (sql.includes("from opportunities")) {
      return { id: OPP, org_id: ORG, stage: m.stage, status: "open", tier: "review",
        pursuit_state: "active", pursuit_reason: null, pursuit_version: 1, submission_state: null,
        // Model the actual selected columns so omitting the fact cannot pass.
        ...(sql.includes("is_sources_sought") || /select\s+(?:o\.)?\*/.test(sql)
          ? { is_sources_sought: m.research } : {}),
      };
    }
    return null;
  });
});

describe("Sources Sought cannot restart bid automation", () => {
  it.each(["rerun", "send_back"])("refuses the %s action before mutating saved history", async (name) => {
    m.stage = "sub_research";
    const response = await action(request({ action: name }), { params: Promise.resolve({ id: OPP }) });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/Sources Sought|market research/i);
    expect(m.query).not.toHaveBeenCalled();
    expect(m.backendEnqueue).not.toHaveBeenCalled();
  });

  it.each(["pricing-research", "sub-finder", "bid-builder", "outreach"])("does not enqueue %s for a research notice", async (name) => {
    expect(await enqueue(name, { opportunityId: OPP }, { orgId: ORG })).toBeNull();
    expect(m.backendEnqueue).not.toHaveBeenCalled();
  });

  it.each(["rerun", "send_back"])("rechecks notice classification in the %s write", async (name) => {
    m.research = false;
    m.stage = "sub_research";
    // The notice changes after the route read but before its conditional write.
    m.query.mockImplementation(async (sql: string) => {
      m.research = true;
      return sql.includes("is_sources_sought is not true") ? [] : [{ id: OPP }];
    });
    const response = await action(request({ action: name }), { params: Promise.resolve({ id: OPP }) });
    expect(response.status).toBe(409);
    expect(m.backendEnqueue).not.toHaveBeenCalled();
  });

  it("also rejects the generic manual-run API", async () => {
    const response = await manualRun(request({ opportunityId: OPP, force: true }), {
      params: Promise.resolve({ name: "pricing-research" }),
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/Sources Sought|market research/i);
    expect(m.backendEnqueue).not.toHaveBeenCalled();
  });

  it.each(["pricing-research", "sub-finder", "bid-builder", "outreach"])("retires already queued %s without running its handler", async (name) => {
    const result = await runAgent(definition(name), "queue", { opportunityId: OPP, [PURSUIT_VERSION_KEY]: 1 });
    expect(result).toMatchObject({ ok: true, permanent: true });
    expect(result.summary).toMatch(/Sources Sought|market research/i);
    expect(shouldQueueRetry(result)).toBe(false);
    expect(m.handler).not.toHaveBeenCalled();
    expect(m.backendEnqueue).not.toHaveBeenCalled();
  });

  it("preserves the unsent Sources Sought response workflow", async () => {
    expect(await enqueue("sources-sought-responder", { opportunityId: OPP })).toBe("synthetic-job");
    const result = await runAgent(definition("sources-sought-responder"), "queue", {
      opportunityId: OPP, [PURSUIT_VERSION_KEY]: 1,
    });
    expect(result.ok).toBe(true);
    expect(m.handler).toHaveBeenCalledTimes(1);
  });

  it("preserves ordinary bid jobs and unrelated account jobs", async () => {
    m.research = false;
    expect(await enqueue("pricing-research", { opportunityId: OPP })).toBe("synthetic-job");
    expect((await runAgent(definition("pricing-research"), "queue", {
      opportunityId: OPP, [PURSUIT_VERSION_KEY]: 1,
    })).ok).toBe(true);
    m.research = true;
    expect((await runAgent(definition("analytics-engine"), "cron", { orgId: ORG })).ok).toBe(true);
    expect(m.handler).toHaveBeenCalledTimes(2);
  });
});
