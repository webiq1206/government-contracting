import { beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const m = vi.hoisted(() => ({ query: vi.fn(), enqueue: vi.fn(), log: vi.fn(), hold: vi.fn() }));
vi.mock("../lib/reply-processing-lock", () => ({ assertReplyProcessingOwnership: async () => {} }));
vi.mock("../lib/db", () => ({ query: m.query, queryOne: vi.fn(), transaction: vi.fn() }));
vi.mock("../lib/queue", () => ({ enqueue: m.enqueue }));
vi.mock("../lib/queue/ai-admission", () => ({ aiEnqueueHold: m.hold }));
vi.mock("../lib/logger", () => ({ logAgent: m.log }));
vi.mock("../lib/agents/org-fanout", () => ({
  orgsToSweep: async () => ({ orgs: [{ id: "tenant-a" }], error: null }), fanoutNote: () => null,
}));
vi.mock("../lib/app-settings", () => ({ getAutomationRules: async () => ({ work_execution: "subcontracted" }) }));
import { stalledPipelineSweep } from "../lib/agents/maintenance";

describe("stalled pipeline recovery admission", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.hold.mockResolvedValue(null);
    m.enqueue.mockResolvedValue("queued-job");
    m.query.mockImplementation(async (sql: string, params: unknown[]) =>
      sql.includes("returning id, title") && !sql.includes("human_action_required = true") && params[0] === "analysis"
        ? [{ id: "opportunity-a", title: "Synthetic public notice" }] : []);
  });
  const run = () => stalledPipelineSweep.handler({ runId: "offline-test", trigger: "cron", payload: {} });
  const removals = () => m.query.mock.calls.filter(([sql]) => sql.includes("array_remove"));

  it("defers a null admission without claiming recovery or a queue failure, and removes the retry marker", async () => {
    m.enqueue.mockResolvedValue(null);
    const result = await run();
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("deferred");
    expect(result.summary).toContain("Auto-retried 0");
    expect(removals()).toHaveLength(1);
    expect(removals()[0][1]).toEqual(["opportunity-a", "auto_retried_analysis", "tenant-a"]);
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ action: "retry-deferred", status: "skipped" }));
    expect(m.log.mock.calls.some(([entry]) => entry.status === "error")).toBe(false);
  });

  it("does not mark, enqueue or escalate an AI stage while an existing provider refusal holds it", async () => {
    m.hold.mockResolvedValue("AI_UNAVAILABLE: OpenAI insufficient credit");
    for (let i = 0; i < 3; i++) {
      const result = await run();
      expect(result.ok).toBe(true);
      expect(result.summary).toContain("held");
    }
    expect(m.enqueue).not.toHaveBeenCalled();
    expect(m.query.mock.calls.some(([sql, params]) => sql.includes("update opportunities") && params[0] === "analysis")).toBe(false);
    expect(m.log.mock.calls.some(([entry]) => entry.status === "error")).toBe(false);
  });

  it("counts only a confirmed admission as a rescue and keeps its marker", async () => {
    const result = await run();
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("Auto-retried 1");
    expect(removals()).toHaveLength(0);
  });

  it("keeps a real backend error visible and rolls back the marker", async () => {
    m.enqueue.mockRejectedValue(new Error("queue database unavailable"));
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.humanActionRequired).toBe(true);
    expect(result.summary).toContain("1 automatic retry could not be queued");
    expect(removals()).toHaveLength(1);
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ status: "error", message: expect.stringContaining("queue database unavailable") }));
  });

  it("does not claim a clean deferral if the retry marker cannot be removed", async () => {
    m.enqueue.mockResolvedValue(null);
    const query = m.query.getMockImplementation()!;
    m.query.mockImplementation(async (sql, params) => {
      if (sql.includes("array_remove")) throw new Error("marker cleanup unavailable");
      return query(sql, params);
    });
    await expect(run()).rejects.toThrow("marker cleanup unavailable");
  });

  it("preserves stopped, research, self-performed outreach and other-tenant records at both strikes", async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        create table opportunities (
          id text primary key, org_id text, title text, status text default 'open',
          stage text default 'analysis', human_action_required boolean default false,
          pursuit_state text default 'active', is_sources_sought boolean default false,
          work_mode text default 'subcontracted', risk_flags text[] default '{}',
          updated_at timestamptz default now() - interval '30 days'
        );
        create table bids (opportunity_id text);
        insert into opportunities(id, org_id) values ('active', 'tenant-a');
        insert into opportunities(id, org_id, pursuit_state, risk_flags)
          select state || '-' || strike, 'tenant-a', state,
            case when strike=2 then array['auto_retried_analysis'] else '{}'::text[] end
          from unnest(array['paused','aborted']) state cross join generate_series(1,2) strike;
        insert into opportunities(id, org_id, is_sources_sought, risk_flags)
          select 'research-' || strike, 'tenant-a', true,
            case when strike=2 then array['auto_retried_analysis'] else '{}'::text[] end
          from generate_series(1,2) strike;
        insert into opportunities(id, org_id, stage, work_mode, risk_flags)
          select 'self-' || strike, 'tenant-a', 'outreach', 'self',
            case when strike=2 then array['auto_retried_outreach'] else '{}'::text[] end
          from generate_series(1,2) strike;
        insert into opportunities(id, org_id, risk_flags)
          select 'other-' || strike, 'tenant-b',
            case when strike=2 then array['auto_retried_analysis'] else '{}'::text[] end
          from generate_series(1,2) strike;
      `);
      const protectedRows = () => db.query("select * from opportunities where id <> 'active' order by id");
      const before = (await protectedRows()).rows;
      m.query.mockImplementation(async (sql, params) => (await db.query(sql, params)).rows);
      const result = await run();
      expect(result.ok).toBe(true);
      expect(m.enqueue).toHaveBeenCalledTimes(1);
      expect(m.enqueue).toHaveBeenCalledWith("solicitation-analyst", { opportunityId: "active", trigger: "rescue" });
      expect((await protectedRows()).rows).toEqual(before);
    } finally {
      await db.close();
    }
  }, 30000);
});
