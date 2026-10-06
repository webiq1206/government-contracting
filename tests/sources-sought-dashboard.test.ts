import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const state = vi.hoisted(() => ({ db: null as unknown as PGlite, org: "tenant-a" }));
vi.mock("@/lib/db", () => ({
  query: async (sql: string, args: unknown[] = []) => (await state.db.query(sql, args)).rows,
  queryOne: async (sql: string, args: unknown[] = []) => (await state.db.query(sql, args)).rows[0] ?? null,
}));
vi.mock("@/lib/tenant", () => ({ resolveTenantOrgId: async () => state.org }));
vi.mock("@/lib/sub-compliance-store", () => ({ loadAwardCompliance: vi.fn(), needsAttentionOnWonWork: vi.fn() }));
vi.mock("@/lib/worker-heartbeat", () => ({ readWorkerHeartbeat: vi.fn() }));

import { pipelineOpportunities, opportunityTable, opportunityTableCount, reviewQueue, scoreHistogram } from "@/lib/data";

beforeAll(async () => {
  // A private in-memory schema, with no environment credentials or migrations.
  state.db = new PGlite();
  await state.db.exec(`create table opportunities (
    id text, org_id text, title text, solicitation_number text, naics_code text,
    set_aside_type text, value_estimated numeric, value_estimated_source text,
    deadline timestamptz, posted_at timestamptz, location_state text, agency text, sub_agency text,
    score integer, score_breakdown jsonb, tier text, risk_flags text[], stage text,
    status text, human_action_required boolean, snoozed_until timestamptz, pursuit_state text,
    created_at timestamptz default now(), updated_at timestamptz default now(),
    review_expires_at timestamptz, is_sources_sought boolean
  );
  insert into opportunities(id,org_id,title,score,tier,stage,status,human_action_required,is_sources_sought)
  values ('bid','tenant-a','Solicitation',65,'review','scoring','open',true,false),
    ('research','tenant-a','Market research',95,'review','scoring','open',true,true),
    ('other-bid','tenant-b','Private bid',80,'review','scoring','open',true,false),
    ('other-research','tenant-b','Private research',99,'review','scoring','open',true,true);`);
}, 30_000);
afterAll(async () => { await state.db?.close(); });

describe("Sources Sought separation and tenant scope", () => {
  it("hides aborted, paused and future-snoozed reviews but keeps elapsed snoozes reviewable", async () => {
    await state.db.exec(`insert into opportunities(id,org_id,title,score,tier,status,pursuit_state,snoozed_until,is_sources_sought,human_action_required)
      values ('aborted','tenant-a','Stopped',70,'review','open','aborted',null,false,true),
        ('snoozed','tenant-a','Later',71,'review','open','active',now()+interval '1 day',false,true),
        ('paused','tenant-a','Paused for review',72,'review','open','paused',null,false,true),
        ('returned','tenant-a','Ready again',73,'review','open','active',now()-interval '1 day',false,true);`);
    await state.db.exec("update opportunities set stage = 'scoring' where id in ('aborted','snoozed','paused','returned')");
    try {
      expect((await reviewQueue()).map(row => row.id).sort()).toEqual(["bid", "returned"]);
      expect((await state.db.query("select id from opportunities where id in ('aborted','snoozed')")).rows).toHaveLength(2);
    } finally {
      await state.db.exec("delete from opportunities where id in ('aborted','snoozed','paused','returned')");
    }
  });
  it("excludes market research from lists, counts, review and score recommendations", async () => {
    expect((await pipelineOpportunities()).map(x => x.id)).toEqual(["bid"]);
    expect((await opportunityTable({ includeClosed: true })).map(x => x.id)).toEqual(["bid"]);
    expect(await opportunityTableCount({ includeClosed: true })).toBe(1);
    expect((await reviewQueue()).map(x => x.id)).toEqual(["bid"]);
    const scores = await scoreHistogram();
    expect(scores[65]).toBe(1);
    expect(scores[95]).toBe(0);
    expect(scores.reduce((a,b) => a+b,0)).toBe(1);
  });
  it("preserves historical records and gives a different tenant only its own bid", async () => {
    expect((await state.db.query("select id from opportunities where is_sources_sought")).rows).toHaveLength(2);
    state.org = "tenant-b";
    expect((await pipelineOpportunities()).map(x => x.id)).toEqual(["other-bid"]);
    state.org = "empty-tenant";
    expect(await opportunityTableCount()).toBe(0);
    expect(await reviewQueue()).toEqual([]);
    state.org = "tenant-a";
  });
});
