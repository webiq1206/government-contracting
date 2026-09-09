import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const state = vi.hoisted(() => ({
  db: null as any,
  failFinish: false,
  stripeCalls: [] as any[],
  failItem: false,
}));
vi.mock("../lib/db", () => ({
  query: async (sql: string, params: unknown[] = []) => {
    if (
      state.failFinish &&
      sql.startsWith("update api_usage_events e set finished")
    )
      throw new Error("write failed");
    return (await state.db.query(sql, params)).rows;
  },
  queryOne: async (sql: string, params: unknown[] = []) =>
    (await state.db.query(sql, params)).rows[0] ?? null,
  transaction: async (fn: any) =>
    state.db.transaction((tx: any) =>
      fn({
        query: async (sql: string, params: unknown[] = []) => {
          if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
          return tx.query(sql, params);
        },
      }),
    ),
}));
vi.mock("../lib/integration-settings", () => ({
  decryptSecret: (s: string) => s,
  isAllowedKey: (s: string) => s === "ANTHROPIC_API_KEY",
}));
vi.mock("../lib/billing/stripe", () => ({
  getStripe: () => ({
    invoices: {
      create: async (body: any, options: any) => {
        state.stripeCalls.push({ kind: "invoice", body, options });
        return { id: "in_" + options.idempotencyKey };
      },
    },
    invoiceItems: {
      create: async (body: any, options: any) => {
        state.stripeCalls.push({ kind: "item", body, options });
        if (state.failItem) throw new Error("Stripe unavailable");
        return { id: "ii_" + options.idempotencyKey };
      },
    },
  }),
}));
import { createUsageInvoice } from "../lib/api-usage/invoice";
import {
  beginUsage,
  finishUsage,
  metered,
  requestIdentity,
  ApiUsageBlockedError,
} from "../lib/api-usage/ledger";
import { readUsage } from "../lib/api-usage/read";
import { readBudget, saveBudget } from "../lib/api-usage/budgets";
import { invoiceCents } from "../lib/api-usage/money";
const org = "00000000-0000-4000-8000-000000000002";
const other = "00000000-0000-4000-8000-000000000003";
const identity = {
  orgId: org,
  envKey: "ANTHROPIC_API_KEY",
  value: "test-platform-secret",
  source: "platform" as const,
  accepted: true,
};
beforeAll(async () => {
  state.db = new PGlite();
  await state.db
    .exec(`create table organizations(id uuid primary key,name text,stripe_customer_id text);
 create table integration_settings(org_id uuid,env_key text,value_enc text);
 create table platform_key_usage(org_id uuid,env_key text,calls int,last_used timestamptz,primary key(org_id,env_key));`);
  await state.db.exec(
    readFileSync("db/migrations/112_api_usage_ledger.sql", "utf8"),
  );
  await state.db.exec(readFileSync("db/migrations/113_api_spending_controls.sql", "utf8"));
  await state.db.exec(readFileSync("db/migrations/116_api_safe_defaults.sql", "utf8"));
  await state.db.query(
    "insert into organizations(id,name) values($1,$2),($3,$4)",
    [org, "Test account", other, "Other account"],
  );
}, 30000);
afterAll(async () => {
  await state.db?.close();
});
beforeEach(async () => {
  state.failFinish = false;
  state.failItem = false;
  state.stripeCalls = [];
  await state.db.exec(
    "truncate api_account_budgets,api_usage_events,api_usage_invoice_batches,api_usage_limits,api_usage_rates,api_usage_preferences,platform_key_usage,integration_settings",
  );
  await state.db.query("insert into api_account_budgets(org_id) values($1),($2)",[org,other]);
});
it("records exact costs and 1.25x charges without rounding each tiny request", async () => {
  for (let i = 0; i < 20; i++) {
    const id = await beginUsage(
      identity,
      "Anthropic",
      "test-model",
      "Analysis",
    );
    await finishUsage(id, {
      actualCost: "0.0004",
      units: { input_tokens: 10 },
    });
  }
  const { rows } = await state.db.query(
    "select sum(provider_cost)::text as cost,sum(tenant_charge)::text as charge from api_usage_events",
  );
  expect(Number(rows[0].cost)).toBe(0.008);
  expect(Number(rows[0].charge)).toBe(0.01);
  expect(invoiceCents(rows[0].charge)).toBe(1);
});
it("never bills a tenant for its own API or unaccepted platform usage", async () => {
  for (const value of [
    { ...identity, source: "tenant" as const },
    { ...identity, accepted: false },
  ]) {
    const id = await beginUsage(value, "Anthropic", "test", "Analysis");
    await finishUsage(id, { actualCost: "10" });
    const { rows } = await state.db.query(
      "select tenant_charge::text as charge,billing_status from api_usage_events where id=$1",
      [id],
    );
    expect(Number(rows[0].charge)).toBe(0);
    expect(rows[0].billing_status).not.toBe("unbilled");
  }
});
it("keeps unknown failure costs unknown and captures failed requests", async () => {
  const execute = vi.fn().mockRejectedValue(new Error("timeout"));
  await expect(
    metered(identity, "Anthropic", "test", "Analysis", execute),
  ).rejects.toThrow("timeout");
  const { rows } = await state.db.query(
    "select outcome,provider_cost,billing_status from api_usage_events",
  );
  expect(rows[0]).toMatchObject({
    outcome: "failed",
    provider_cost: null,
    billing_status: "review",
  });
  expect(execute).toHaveBeenCalledTimes(1);
});
it("does not replay a successful provider action when ledger finalization fails", async () => {
  state.failFinish = true;
  const execute = vi.fn().mockResolvedValue({ id: "provider-1" });
  await expect(
    metered(identity, "Anthropic", "test", "Analysis", execute),
  ).resolves.toEqual({ id: "provider-1" });
  expect(execute).toHaveBeenCalledTimes(1);
  const { rows } = await state.db.query("select outcome from api_usage_events");
  expect(rows[0].outcome).toBe("pending");
});
it("enforces pauses and hard-limit uncertainty before executing paid work", async () => {
  await state.db.query(
    "insert into api_usage_limits(org_id,paused) values($1,true)",
    [org],
  );
  const execute = vi.fn();
  await expect(
    metered(identity, "Anthropic", "test", "Analysis", execute),
  ).rejects.toBeInstanceOf(ApiUsageBlockedError);
  expect(execute).not.toHaveBeenCalled();
  await state.db.exec(
    "update api_usage_limits set paused=false,monthly_limit=10",
  );
  await expect(
    metered(identity, "Anthropic", "test", "Analysis", execute),
  ).rejects.toThrow("configured maximum");
  expect(execute).not.toHaveBeenCalled();
});
it("tenant reads cannot change tenant scope or receive underlying cost, margin, or evidence", async () => {
  for (const orgId of [org, other]) {
    const id = await beginUsage(
      { ...identity, orgId },
      "Anthropic",
      "test",
      "Analysis",
    );
    await finishUsage(id, {
      actualCost: "10",
      evidence: "private provider cost evidence",
    });
  }
  const data = await readUsage(
    new URLSearchParams({ tenant: other, sort: "cost" }),
    org,
  );
  expect(data.rows).toHaveLength(1);
  expect(data.rows[0].org_id).toBe(org);
  const serialized = JSON.stringify(data);
  expect(serialized).not.toContain("private provider cost evidence");
  expect(serialized).not.toContain("provider_cost");
  expect(serialized).not.toContain("margin");
});
it("admin totals include every matching row beyond the activity page", async () => {
  for (let i = 0; i < 51; i++) {
    const id = await beginUsage(identity, "Anthropic", "test", "Analysis");
    await finishUsage(id, { actualCost: "1" });
  }
  const data = await readUsage(new URLSearchParams());
  expect(data.rows).toHaveLength(20);
  expect(data.summary.calls).toBe(51);
  expect(Number(data.summary.provider_cost)).toBe(51);
});
it("classifies the exact platform credential even if saved as a tenant key", async () => {
  process.env.ANTHROPIC_API_KEY = "test-platform-secret";
  await state.db.query("insert into integration_settings values($1,$2,$3)", [
    org,
    "ANTHROPIC_API_KEY",
    "test-platform-secret",
  ]);
  expect(
    (await requestIdentity("ANTHROPIC_API_KEY", "test-platform-secret", org))
      .source,
  ).toBe("platform");
  delete process.env.ANTHROPIC_API_KEY;
});
it("rounds only invoice aggregates and rejects malformed currency", () => {
  expect(invoiceCents("0.005")).toBe(1);
  expect(invoiceCents("12.50")).toBe(1250);
  expect(() => invoiceCents("-1")).toThrow();
  expect(() => invoiceCents("NaN")).toThrow();
});

it("creates one invoice from the exact aggregate and never invoices those events twice", async () => {
  await state.db.query(
    "update organizations set stripe_customer_id=$2 where id=$1",
    [org, "cus_test"],
  );
  for (let i = 0; i < 20; i++) {
    const id = await beginUsage(identity, "Anthropic", "test", "Analysis");
    await finishUsage(id, { actualCost: "0.0004" });
  }
  const invoice = await createUsageInvoice(org, "admin");
  expect(invoice).toContain("in_");
  const item = state.stripeCalls.find((c) => c.kind === "item");
  expect(item.body.amount).toBe(1);
  expect(
    state.stripeCalls.find((c) => c.kind === "invoice").body.auto_advance,
  ).toBe(false);
  await expect(createUsageInvoice(org, "admin")).rejects.toThrow(
    "No confirmed",
  );
  expect(
    (
      await state.db.query(
        "select count(*)::int as count from api_usage_events where billing_status='pending'",
      )
    ).rows[0].count,
  ).toBe(20);
});
it("reuses the same batch after an interrupted Stripe write", async () => {
  await state.db.query(
    "update organizations set stripe_customer_id=$2 where id=$1",
    [org, "cus_test"],
  );
  const id = await beginUsage(identity, "Anthropic", "test", "Analysis");
  await finishUsage(id, { actualCost: "10" });
  state.failItem = true;
  await expect(createUsageInvoice(org, "admin")).rejects.toThrow(
    "Stripe unavailable",
  );
  state.failItem = false;
  await createUsageInvoice(org, "admin");
  const items = state.stripeCalls.filter((c) => c.kind === "item");
  expect(items[0].options.idempotencyKey).toBe(items[1].options.idempotencyKey);
  expect(state.stripeCalls.filter((c) => c.kind === "invoice")).toHaveLength(1);
});
it("preserves rounding differences across multiple invoices", async () => {
  await state.db.query(
    "update organizations set stripe_customer_id=$2 where id=$1",
    [org, "cus_test"],
  );
  for (let i = 0; i < 2; i++) {
    const id = await beginUsage(identity, "Anthropic", "test", "Analysis");
    await finishUsage(id, { actualCost: "0.012" });
    await createUsageInvoice(org, "admin");
  }
  const amounts = state.stripeCalls
    .filter((c) => c.kind === "item")
    .map((c) => c.body.amount);
  expect(amounts).toEqual([2, 1]);
});

it("reserves in-flight maximum costs against spending limits", async () => {
  await state.db.query(
    "insert into api_usage_rates(provider,service,rates,evidence,max_request_cost) values('Anthropic','test','{}','test rate',6)",
  );
  await state.db.query(
    "insert into api_usage_limits(org_id,monthly_limit) values($1,10)",
    [org],
  );
  const id = await beginUsage(identity, "Anthropic", "test", "Analysis");
  await expect(
    beginUsage(identity, "Anthropic", "test", "Analysis"),
  ).rejects.toThrow("cannot cover");
  await finishUsage(id, { actualCost: "2" });
  await expect(
    beginUsage(identity, "Anthropic", "test", "Analysis"),
  ).resolves.toBeTypeOf("string");
});

const unlimitedBudget = {dailyLimit:null,monthlyLimit:null,dailyRequests:null,paused:false,allowComplex:true};
it("limits concurrent admissions before any provider call, including own keys", async () => {
  await saveBudget(org,"owner",{...unlimitedBudget,dailyRequests:1});
  const results = await Promise.allSettled([1,2,3].map(() => beginUsage({...identity,source:"tenant"},"Anthropic","test","Analysis")));
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  expect(results.filter(r=>r.status==="rejected")).toHaveLength(2);
  const b = await readBudget(org);
  expect(b?.day_requests).toBe(1);
  await expect(beginUsage({...identity,orgId:other},"Anthropic","test","Analysis")).resolves.toBeTruthy();
});
it("holds customer-facing platform charges and own-key costs against dollar budgets", async () => {
  await state.db.query("insert into api_usage_rates(provider,service,rates,max_request_cost,evidence) values('Anthropic','test','{}',1,'test ceiling')");
  await saveBudget(org,"owner",{...unlimitedBudget,monthlyLimit:"2.25"});
  await beginUsage(identity,"Anthropic","test","Analysis");
  await expect(beginUsage(identity,"Anthropic","test","Analysis")).rejects.toThrow("allowance");
  await beginUsage({...identity,source:"tenant"},"Anthropic","test","Analysis");
  await expect(beginUsage({...identity,source:"tenant"},"Anthropic","test","Analysis")).rejects.toThrow("allowance");
  expect(Number((await readBudget(org))?.month_spend)).toBe(2.25);
});
it("blocks unpriced own-key requests only when a dollar cap is enabled", async () => {
  await saveBudget(org,"owner",{...unlimitedBudget,dailyLimit:"10"});
  await expect(beginUsage({...identity,source:"tenant"},"Anthropic","test","Analysis")).rejects.toThrow("price ceiling");
  await saveBudget(org,"owner",{...unlimitedBudget,dailyRequests:10});
  await expect(beginUsage({...identity,source:"tenant"},"Anthropic","test","Analysis")).resolves.toBeTruthy();
});
it("resumes after editing a pause without removing platform restrictions", async () => {
  await saveBudget(org,"owner",{...unlimitedBudget,paused:true});
  await expect(beginUsage(identity,"Anthropic","test","Analysis")).rejects.toThrow("paused");
  await saveBudget(org,"owner",unlimitedBudget);
  await state.db.query("insert into api_usage_limits(org_id,paused) values(null,true)");
  await expect(beginUsage(identity,"Anthropic","test","Analysis")).rejects.toThrow("paused");
});
it("routine-only mode holds complex tasks but allows cheap work", async () => {
  await saveBudget(org,"owner",{...unlimitedBudget,allowComplex:false});
  await expect(beginUsage(identity,"Anthropic","test","Analysis",{complex:true})).rejects.toThrow("Complex AI");
  await expect(beginUsage(identity,"Anthropic","test","Summary")).resolves.toBeTruthy();
});
it("a zero request limit pauses immediately and old requests do not consume today", async () => {
  await saveBudget(org,"owner",{...unlimitedBudget,dailyRequests:0});
  await expect(beginUsage(identity,"Anthropic","test","Analysis")).rejects.toThrow("request limit");
  await saveBudget(org,"owner",{...unlimitedBudget,dailyRequests:1});
  const id = await beginUsage(identity,"Anthropic","test","Analysis");
  await state.db.query("update api_usage_events set started_at=now()-interval '2 days' where id=$1",[id]);
  await expect(beginUsage(identity,"Anthropic","test","Analysis")).resolves.toBeTruthy();
});
it("rejects invalid settings before writing any budget", async () => {
  for (const bad of [{dailyLimit:"-1"},{monthlyLimit:"NaN"},{dailyRequests:1.5},{dailyRequests:1000001},{orgId:other}]) {
    await expect(saveBudget(org,"owner",{...unlimitedBudget,...bad})).rejects.toThrow();
  }
  expect((await state.db.query("select * from api_account_budgets where daily_limit is not null or daily_requests is not null")).rows).toHaveLength(0);
});
it("a global request allowance counts tenants together but excludes their own keys", async () => {
  await state.db.query("insert into api_usage_limits(daily_requests) values(1)");
  await beginUsage(identity,"Anthropic","test","Analysis");
  await expect(beginUsage({...identity,orgId:other},"Anthropic","test","Analysis")).rejects.toThrow("platform's daily");
  await expect(beginUsage({...identity,orgId:other,source:"tenant"},"Anthropic","test","Analysis")).resolves.toBeTruthy();
});
it("dollar limits hold unknown historical charges even with newly configured pricing", async () => {
  await beginUsage(identity,"Anthropic","test","Analysis");
  await state.db.query("insert into api_usage_rates(provider,service,rates,max_request_cost,evidence) values('Anthropic','test','{}',1,'test ceiling')");
  await saveBudget(org,"owner",{...unlimitedBudget,dailyLimit:"100"});
  await expect(beginUsage(identity,"Anthropic","test","Analysis")).rejects.toThrow("awaiting confirmation");
});
const haikuRates={input_tokens:"1",output_tokens:"5",cache_read_input_tokens:"0.1",cache_creation_input_tokens:"1.25"};
async function seedHaiku() {
  await state.db.query("insert into api_usage_rates(provider,service,rates,max_request_cost,evidence) values('Anthropic','claude-haiku-4-5',$1,2,'published test rates')",[JSON.stringify(haikuRates)]);
}
it("estimates token usage automatically without creating a confirmed charge or invoice", async()=>{
  await seedHaiku();
  const id=await beginUsage(identity,"Anthropic","claude-haiku-4-5","Summary");
  await finishUsage(id,{units:{input_tokens:1000,output_tokens:100,cache_read_input_tokens:2000,cache_creation_input_tokens:1000}});
  const row=(await state.db.query("select * from api_usage_events where id=$1",[id])).rows[0];
  expect(Number(row.estimated_cost)).toBeCloseTo(.00295,10);
  expect(Number(row.budget_cost)).toBeCloseTo(.003245,10);
  expect(row.provider_cost).toBeNull();expect(row.billing_status).toBe("review");
  const view=await readUsage(new URLSearchParams(),org);
  expect(view.rows[0].tenant_charge).toBeNull();
  expect(Number(view.rows[0].usage_amount)).toBeCloseTo(.0036875,10);
  expect(JSON.stringify(view)).not.toContain('price_snapshot');
});
it("prices are snapshotted so a settings edit cannot reprice an in-flight call", async()=>{
  await seedHaiku();const id=await beginUsage(identity,"Anthropic","claude-haiku-4-5","Summary");
  await state.db.query("update api_usage_rates set rates='{}'");
  await finishUsage(id,{units:{input_tokens:1000,output_tokens:100}});
  expect(Number((await state.db.query("select estimated_cost from api_usage_events where id=$1",[id])).rows[0].estimated_cost)).toBe(.0015);
});
it("a successful priced call releases its large provisional hold without calling it free",async()=>{
  await seedHaiku();await saveBudget(org,"owner",{...unlimitedBudget,dailyLimit:"3"});
  const id=await beginUsage(identity,"Anthropic","claude-haiku-4-5","Summary");
  await expect(beginUsage(identity,"Anthropic","claude-haiku-4-5","Summary")).rejects.toThrow();
  await finishUsage(id,{units:{input_tokens:1000,output_tokens:100}});
  await expect(beginUsage(identity,"Anthropic","claude-haiku-4-5","Summary")).resolves.toBeTruthy();
});
it("unknown or failed usage keeps its reservation rather than freeing budget", async()=>{
  await seedHaiku();const id=await beginUsage(identity,"Anthropic","claude-haiku-4-5","Summary");
  await finishUsage(id,{failed:true,units:{requests:1}});
  const row=(await state.db.query("select * from api_usage_events where id=$1",[id])).rows[0];
  expect(row.budget_cost).toBeNull();expect(row.estimated_cost).toBeNull();expect(Number(row.reserved_cost)).toBe(2);
});
it("new accounts have spending protection even before opening settings",async()=>{
  await seedHaiku();await state.db.query("delete from api_account_budgets where org_id=$1",[org]);
  const b=await readBudget(org);expect(b?.daily_requests).toBe(100);expect(b?.monthly_limit).toBe("250");
  for(let i=0;i<10;i++) await beginUsage(identity,"Anthropic","claude-haiku-4-5","Summary");
  await expect(beginUsage(identity,"Anthropic","claude-haiku-4-5","Summary")).rejects.toThrow("daily");
});
it("accepted platform selection finds the key saved in Settings without an environment key",async()=>{
  const foundation="00000000-0000-4000-8000-000000000001";
  await state.db.query("insert into organizations(id,name) values($1,'Platform') on conflict do nothing",[foundation]);
  await state.db.query("insert into integration_settings values($1,'ANTHROPIC_API_KEY','saved-platform-key')",[foundation]);
  await state.db.query("insert into api_usage_preferences(org_id,env_key,source,accepted_at) values($1,'ANTHROPIC_API_KEY','platform',now())",[org]);
  const {orgApiKey,clearIntegrationKeyCache}=await import("../lib/integration-keys");clearIntegrationKeyCache();
  delete process.env.ANTHROPIC_API_KEY;
  expect(await orgApiKey("ANTHROPIC_API_KEY",org)).toBe("saved-platform-key");
});
it("migration repairs old token costs, holds unfinished calls, and preserves selected limits", async()=>{
  const db=new PGlite();
  try {
    await db.exec("create table organizations(id uuid primary key,name text);");
    await db.exec(readFileSync("db/migrations/112_api_usage_ledger.sql","utf8"));
    await db.exec(readFileSync("db/migrations/113_api_spending_controls.sql","utf8"));
    await db.query("insert into organizations values($1,'Owner'),($2,'Tenant')",[org,other]);
    await db.query("insert into api_account_budgets(org_id,daily_limit,monthly_limit,paused) values($1,150,1000,true)",[org]);
    await db.query(`insert into api_usage_events(id,org_id,provider,service,feature,credential_source,credential_fingerprint,outcome,usage)
      values(gen_random_uuid(),$1,'Anthropic','claude-haiku-4-5','Summary','platform','test','success','{"input_tokens":1000,"output_tokens":100}'),
      (gen_random_uuid(),$1,'Anthropic','claude-sonnet-5','Analysis','platform','test','pending','{}')`,[org]);
    await db.exec(readFileSync("db/migrations/116_api_safe_defaults.sql","utf8"));
    const rows=(await db.query("select * from api_usage_events order by outcome")).rows as any[];
    expect(rows.every(r=>r.provider_cost===null)).toBe(true);
    expect(Number(rows.find(r=>r.outcome==='success').estimated_cost)).toBe(.0015);
    expect(Number(rows.find(r=>r.outcome==='pending').reserved_cost)).toBe(10);
    const owner=(await db.query("select * from api_account_budgets where org_id=$1",[org])).rows[0] as any;
    expect(Number(owner.daily_limit)).toBe(150);expect(Number(owner.monthly_limit)).toBe(1000);expect(owner.paused).toBe(true);expect(owner.daily_requests).toBe(100);
    const tenant=(await db.query("select * from api_account_budgets where org_id=$1",[other])).rows[0] as any;
    expect(Number(tenant.monthly_limit)).toBe(250);
  } finally {await db.close();}
},30000);
it("free public-data lookups do not exhaust the paid request allowance",async()=>{
  await seedHaiku();await saveBudget(org,"owner",{...unlimitedBudget,dailyRequests:1});
  await state.db.query(`insert into api_usage_events(id,org_id,provider,service,feature,credential_source,credential_fingerprint,billing_status,provider_cost)
    values(gen_random_uuid(),$1,'SAM.gov','search','Public data lookup','unknown','public','not_billable',0)`,[org]);
  await expect(beginUsage(identity,"Anthropic","claude-haiku-4-5","Summary")).resolves.toBeTruthy();
  expect((await readBudget(org))?.day_requests).toBe(1);
});
it("a spending recovery check runs the same gate without creating a request or spending credits",async()=>{
  await seedHaiku();await saveBudget(org,"owner",{...unlimitedBudget,paused:true});
  await expect(beginUsage(identity,"Anthropic","claude-haiku-4-5","Summary",{dryRun:true})).rejects.toThrow("paused");
  await saveBudget(org,"owner",unlimitedBudget);
  await expect(beginUsage(identity,"Anthropic","claude-haiku-4-5","Summary",{dryRun:true})).resolves.toBeTruthy();
  expect((await state.db.query("select * from api_usage_events")).rows).toHaveLength(0);
  expect((await state.db.query("select * from platform_key_usage")).rows).toHaveLength(0);
});
it("recovery verifies current saved credentials and releases a corrected budget hold without paid execution",async()=>{
  await seedHaiku();
  const foundation="00000000-0000-4000-8000-000000000001";
  await state.db.query("insert into organizations(id,name) values($1,'Platform') on conflict do nothing",[foundation]);
  await state.db.query("insert into integration_settings values($1,'ANTHROPIC_API_KEY','saved-platform-key')",[foundation]);
  await state.db.query("insert into api_usage_preferences(org_id,env_key,source,accepted_at) values($1,'ANTHROPIC_API_KEY','platform',now())",[org]);
  await beginUsage(identity,"Anthropic","claude-haiku-4-5","Summary");
  await saveBudget(org,"owner",{...unlimitedBudget,paused:true});
  const {checkRecentSpending}=await import("../lib/api-usage/check-spending");
  await expect(checkRecentSpending(org)).rejects.toThrow("paused");
  await saveBudget(org,"owner",unlimitedBudget);
  await expect(checkRecentSpending(org)).resolves.toBeUndefined();
  expect((await state.db.query("select * from api_usage_events")).rows).toHaveLength(1);
});
