import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const state = vi.hoisted(() => ({ db: null as PGlite | null, orgs: [] as {id: string}[] }));
vi.mock("../lib/db", () => ({
  query: async (s: string, p: unknown[] = []) => (await state.db!.query(s, p)).rows,
  queryOne: async (s: string, p: unknown[] = []) => (await state.db!.query(s, p)).rows[0] ?? null,
  transaction: async (fn: (tx: unknown) => unknown) => state.db!.transaction(fn),
}));
vi.mock("../lib/integrations/gmail", () => ({ gmail: { isConnected: async () => true } }));
vi.mock("../lib/agents/org-fanout", () => ({
  orgsToSweep: async () => ({orgs: state.orgs, pausedCount: 0}), fanoutNote: () => null,
}));
vi.mock("../lib/logger", () => ({logAgent: vi.fn()}));
vi.mock("../lib/app-settings", async (original) => ({
  ...await original<typeof import("../lib/app-settings")>(),
  getAutomationRules: async () => ({work_execution: "sub", outreach_batch_limit: 25}),
}));
import { outreachRecoverySweep } from "../lib/agents/maintenance";
import { gatherPlatformFacts } from "../lib/recap/platform";
import { platformImpact } from "../lib/admin/platform-health";

const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ids = new Map<string, string>();
beforeAll(async () => {
  state.db = new PGlite();
  await state.db.exec("create table _migrations(id serial primary key,filename text unique not null,applied_at timestamptz default now(),checksum text)");
  for (const name of readdirSync("db/migrations").filter(f => f.endsWith(".sql")).sort()) {
    await state.db.exec(readFileSync("db/migrations/" + name, "utf8").replace(/create extension[^;]*;/gi, ""));
  }
  for (const id of [org, other]) await state.db.query(
    "insert into organizations(id,name,slug,subscription_status) values($1,$2,$2,'active')", [id,id]);
  state.orgs = [{id: org}];
  for (const label of ["held", "expired", "removed", "self", "unverified", "sent", "foreign"]) {
    const orgId = label === "foreign" ? other : org;
    const result = await state.db.query<{id: string}>(
      `insert into opportunities(org_id,source,title,stage,status,deadline,risk_flags,work_mode)
       values($1,'test',$2,'outreach','open',now()+interval '7 days',array['outreach_incomplete'],'sub') returning id`,
      [orgId,label]);
    const id = result.rows[0].id;
    ids.set(label,id);
    const sub = await state.db.query<{id:string}>(
      "insert into subcontractors(org_id,company_name,email,email_verified) values($1,$2,'test@example.invalid',true) returning id",
      [orgId,label]);
    await state.db.query(`insert into opportunity_subs(opportunity_id,subcontractor_id,trade,verified,outreach_state)
      values($1,$2,'HVAC',$3,$4)`, [id,sub.rows[0].id,label !== "unverified",label === "sent" ? "sent" : "pending"]);
  }
  await state.db.query("update opportunities set deadline=now()-interval '1 day' where id=$1",[ids.get("expired")]);
  await state.db.query("update opportunities set work_mode='self' where id=$1",[ids.get("self")]);
  await state.db.query("update opportunity_subs set removed_at=now(), removed_reason='Test removal' where opportunity_id=$1",[ids.get("removed")]);
},120000);
afterAll(async () => { await state.db?.close(); });

describe("email recovery and reporting with a disposable database", () => {
  it("rechecks only active verified holds and preserves the normal outreach path", async () => {
    const result = await outreachRecoverySweep.handler({} as never);
    expect(result.enqueued).toHaveLength(1);
    expect(result.enqueued?.[0]).toMatchObject({
      agent: "outreach", payload: {opportunityId: ids.get("held"), trade: "HVAC"},
    });
  });

  it("does no recovery work when fanout excludes paused accounts", async () => {
    state.orgs = [];
    const result = await outreachRecoverySweep.handler({} as never);
    expect(result.enqueued).toEqual([]);
    state.orgs = [{id: org}];
  });

  it("reports old active drafts without counting them as sends or failures", async () => {
    await state.db!.query(`insert into communications(org_id,opportunity_id,direction,channel,subject,body,delivery_state,created_at)
      values($1,$2,'outbound','email','Sources sought','Review required','draft',now()-interval '3 days'),
            ($1,$3,'outbound','email','Expired draft','Expired','draft',now()-interval '3 days')`,
      [org,ids.get("held"),ids.get("expired")]);
    const facts = await gatherPlatformFacts(new Date(Date.now()-86400000),new Date(Date.now()+1000));
    expect(facts.pendingMail?.find(p => p.orgId === org)?.drafts).toBe(1);
    expect(facts.emailsSent).toBe(0);
    expect(facts.emailsFailed).toBe(0);
    const impact = await platformImpact();
    expect(impact.sentEmail).toBe(0);
    expect(impact.undeliveredEmail).toBe(0);
  });
});
