import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
const m = vi.hoisted(() => ({queryOne: vi.fn()}));
vi.mock("../lib/db", () => ({queryOne: m.queryOne, query: vi.fn()}));
vi.mock("../lib/data", () => ({currentOrg: async () => "ours", computeCustomKpi: vi.fn()}));
import { automationMetrics } from "../lib/reporting";

describe("automation reporting at account scale", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create table job_runs(id text, org_id text, agent text, status text, opportunity_id text, started_at timestamptz);
      create table opportunities(org_id text, human_action_required boolean, created_at timestamptz);`);
    m.queryOne.mockImplementation(async (sql, params) => (await db.query(sql, params)).rows[0]);
  }, 30000);
  afterAll(async () => { await db?.close(); });
  it("keeps equal timestamps, other tenants, and scheduled runs out of retry counts", async () => {
    await db.exec(`insert into job_runs values
      ('1','ours','a','error','x','2026-01-01'),
      ('2','ours','a','ok','x','2026-01-01'),
      ('3','ours','a','ok','x','2026-01-02'),
      ('4','ours','a','ok',null,'2026-01-02'),
      ('5','other','a','error','x','2025-01-01');`);
    const metrics = await automationMetrics(null, null);
    expect(metrics.find(x=>x.key==='automation_retry_rate')?.value).toBe(25);
    expect(metrics.find(x=>x.key==='automation_recovery_rate')?.value).toBe(100);
    const filtered = await automationMetrics(new Date('2026-01-02'), null);
    expect(filtered.find(x=>x.key==='automation_retry_rate')?.value).toBe(0);
  });
  it("handles a long history without a separate history scan per record", async () => {
    await db.exec(`truncate job_runs;
      insert into job_runs select n::text,'ours','a','ok',n::text,'2026-01-01'::timestamptz from generate_series(1,10000) n;
      set statement_timeout='3000ms';`);
    const metrics = await automationMetrics(null, null);
    expect(metrics.find(x=>x.key==='automation_success_rate')?.value).toBe(100);
    expect(metrics.find(x=>x.key==='automation_retry_rate')?.value).toBe(0);
  }, 10000);
});
