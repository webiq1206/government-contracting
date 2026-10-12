/** Synthetic-only reconciliation tests. CI uses a private PostgreSQL schema;
 * local runs use PGlite. Provider responses are fixtures, never real requests. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
const state = vi.hoisted(() => ({
  db: null as any, realPg: false, failAudit: false, authorized: true,
  dbCalls: 0, credentialCalls: 0, queueCalls: 0,
}));
vi.mock("../lib/db", () => ({
  query: async (sql: string, args: unknown[] = []) => {
    state.dbCalls++;
    return (await state.db.query(sql, args)).rows;
  },
  transaction: async (fn: any) => state.db.transaction((tx: any) => fn({
    query: async (sql: string, args: unknown[] = []) => {
      state.dbCalls++;
      if (!state.realPg && sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (state.failAudit && sql.startsWith("insert into api_usage_audit")) throw new Error("synthetic audit failure");
      return tx.query(sql, args);
    },
  })),
}));
vi.mock("../lib/platform-admin", () => ({
  requirePlatformAdmin: async () => state.authorized
    ? { email: "fixture@example.invalid", organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }
    : new Response("Forbidden", { status: 403 }),
}));
vi.mock("../lib/api-usage/credentials", () => ({
  platformApiValue: async (key: string) => {
    state.credentialCalls++;
    return key === "TWILIO_ACCOUNT_SID" ? "AC" + "a".repeat(32) : "synthetic-token";
  },
}));
vi.mock("../lib/queue", () => ({ enqueue: () => { state.queueCalls++; throw new Error("No replay permitted"); } }));
import { POST } from "../app/api/admin/api-usage/route";
import { syncTwilioCosts } from "../lib/api-usage/reconciliation";
const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const event = "11111111-1111-4111-8111-111111111111";
const requestId = "SM" + "a".repeat(32);
const accountSid = "AC" + "a".repeat(32);
const fingerprint = createHash("sha256").update("synthetic-token").digest("hex");
let cleanup = async () => {};
let fetchMock: ReturnType<typeof vi.fn>;
let heldBefore: unknown;
const receipt = (cost = "1", extra = {}) => new Response(JSON.stringify({
  sid: requestId, account_sid: accountSid, price: "-" + cost, price_unit: "USD", ...extra,
}));
const stored = async () => (await state.db.query("select provider_cost::text,billing_status,evidence,budget_cost::text from api_usage_events where id=$1", [event])).rows[0];
const audits = async () => (await state.db.query("select details from api_usage_audit order by id")).rows;
const holds = async () => ({
  events: (await state.db.query("select * from api_usage_events where provider='OpenAI' order by id")).rows,
  receipts: (await state.db.query("select * from ai_work_receipts order by work_key")).rows,
});
const post = (input: unknown) => POST(new Request("https://fixture.invalid/api/admin/api-usage", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
}));

beforeAll(async () => {
  // Opt into a local disposable PostgreSQL only. Never load application secrets.
  if (process.env.ALLOW_TESTS_AGAINST_DATABASE_URL === "1") {
    // Database CI deliberately puts a non-production placeholder in
    // DATABASE_URL and selects the disposable server through PG* instead.
    const dev = process.env.USE_REPLIT_DEV_DB === "true";
    const url = dev ? null : new URL(process.env.DATABASE_URL ?? "");
    const host = dev ? process.env.PGHOST : url?.hostname;
    if (!host || !new Set(["localhost", "127.0.0.1", "[::1]"]).has(host)) throw new Error("Reconciliation fixtures require loopback PostgreSQL");
    const connection = dev ? {
      host, port: Number(process.env.PGPORT ?? 5432), database: process.env.PGDATABASE,
      user: process.env.PGUSER, password: process.env.PGPASSWORD,
    } : { connectionString: url!.href };
    const { Pool, types } = await import("pg");
    // Match production lib/db.ts. Monetary comparisons must opt into SQL text,
    // not rely on pg's default numeric parser or stringify a rounded Number.
    const originalNumericParser = types.getTypeParser(1700);
    types.setTypeParser(1700, value => Number(value));
    const schema = "receipt_test_" + randomUUID().replaceAll("-", "");
    const admin = new Pool(connection);
    await admin.query(`create schema ${schema}`);
    const pool = new Pool({ ...connection, options: `-c search_path=${schema},public` });
    state.realPg = true;
    state.db = {
      query: (sql: string, args?: unknown[]) => pool.query(sql, args),
      exec: (sql: string) => pool.query(sql),
      transaction: async (fn: any) => {
        const c = await pool.connect();
        try { await c.query("begin"); const result = await fn(c); await c.query("commit"); return result; }
        catch (e) { await c.query("rollback"); throw e; }
        finally { c.release(); }
      },
    };
    cleanup = async () => { await pool.end(); await admin.query(`drop schema ${schema} cascade`); await admin.end(); types.setTypeParser(1700, originalNumericParser); };
  } else {
    state.db = new PGlite({ parsers: { 1700: value => Number(value) } });
    cleanup = () => state.db.close();
  }
  await state.db.exec("create table organizations(id uuid primary key); create function capture_activity() returns trigger language plpgsql as $$ begin return NEW; end $$");
  for (const file of ["112_api_usage_ledger.sql", "113_api_spending_controls.sql", "115_usage_billing_completion.sql", "116_api_safe_defaults.sql", "128_ai_work_receipts.sql"])
    await state.db.exec(readFileSync("db/migrations/" + file, "utf8"));
  await state.db.query("insert into organizations(id) values($1),($2)", [org, other]);
}, 30000);
afterAll(async () => { await cleanup(); });
beforeEach(async () => {
  state.failAudit = false; state.authorized = true;
  state.dbCalls = 0; state.credentialCalls = 0; state.queueCalls = 0;
  await state.db.exec("truncate api_usage_events,api_usage_audit,api_usage_invoice_batches,ai_work_receipts cascade");
  await state.db.query(`insert into api_usage_events(id,org_id,provider,service,feature,credential_source,credential_fingerprint,billing_accepted,provider_request_id,outcome,reserved_cost)
    values($1,$2,'Twilio','sms','Synthetic receipt','platform',$3,true,$4,'success',3)`, [event, org, fingerprint, requestId]);
  await state.db.query(`insert into api_usage_events(id,org_id,provider,service,feature,credential_source,credential_fingerprint,outcome,reserved_cost)
    select gen_random_uuid(),$1,'OpenAI','gpt-4.1','Synthetic historical hold','platform','synthetic-history','failed',3 from generate_series(1,38)`, [org]);
  await state.db.query(`insert into ai_work_receipts(org_id,work_key,scope_key,input_hash,owner,state)
    select $1,'synthetic-'||n,'synthetic-scope','synthetic-input',gen_random_uuid(),'pending' from generate_series(1,3) n`, [org]);
  heldBefore = await holds();
  fetchMock = vi.fn(async () => receipt());
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => {
  try {
    expect(state.queueCalls).toBe(0);
    expect(await holds()).toEqual(heldBefore);
    // Every adapter lookup was intercepted with a fixture at the fetch boundary.
    for (const [url] of fetchMock.mock.calls as unknown[][])
      expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${requestId}.json`);
  } finally { vi.unstubAllGlobals(); }
});

describe("manual reconciliation fails closed", () => {
  const noEffects = async () => {
    expect(state.dbCalls).toBe(0); expect(state.credentialCalls).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled(); expect(await audits()).toHaveLength(0);
    expect((await stored()).provider_cost).toBeNull();
  };
  it("authorizes before rejecting a manual action", async () => {
    state.authorized = false;
    expect((await post({ action: "reconcile" })).status).toBe(403);
    await noEffects();
  });
  it.each([
    { action: "reconcile", cost: "0", evidence: "Alleged no I/O" },
    { action: "reconcile", cost: "1", expectedOrgId: other, expectedProviderAccount: "unbound-account" },
    { action: "reconcile", cost: "1", expectedProviderCost: null, proof: { kind: "never-dispatched", verified: true } },
    { action: "receipts", receipts: [{ id: event, provider: "Twilio", requestId, cost: "1", evidence: "Unverified text", accountSid, verified: true }] },
  ])("rejects unverified $action without I/O", async input => {
    const response = await post({ id: event, ...input });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("Unverified costs remain held");
    await noEffects();
  });
  it("repeated operation IDs cannot create audits or overwrite a known cost", async () => {
    await state.db.query("update api_usage_events set provider_cost=2 where id=$1", [event]);
    for (let n = 0; n < 2; n++)
      expect((await post({ action: "reconcile", id: event, cost: "1", evidence: "Synthetic", operationId: "same", expectedProviderCost: null })).status).toBe(409);
    expect(state.dbCalls).toBe(0); expect(state.credentialCalls).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled(); expect(await audits()).toHaveLength(0);
    expect((await stored()).provider_cost).toBe("2.000000000000");
  });
});

describe("verified Twilio receipts", () => {
  it("matches production numeric parsing while preserving explicit SQL text", async () => {
    const row = (await state.db.query("select 1.25::numeric as parsed, 1.25::numeric::text as exact")).rows[0];
    expect(row).toEqual({ parsed: 1.25, exact: "1.25" });
  });
  it("commits exact cost and one audit atomically with decimal markup", async () => {
    fetchMock.mockResolvedValue(receipt("0.0000008"));
    expect(await syncTwilioCosts()).toBe(1);
    expect((await stored()).provider_cost).toBe("0.000000800000");
    expect((await state.db.query("select tenant_charge::text from api_usage_events where id=$1", [event])).rows[0].tenant_charge).toBe("0.000001000000");
    expect((await audits())[0].details).toMatchObject({ accountSid, requestId, cost: "0.0000008", before: { providerCost: null }, after: { billingStatus: "unbilled" } });
  });
  it.each([
    { account_sid: "AC" + "b".repeat(32) }, { sid: "SM" + "b".repeat(32) },
  ])("rejects a mismatched provider account or request: %j", async extra => {
    fetchMock.mockResolvedValue(receipt("1", extra));
    await expect(syncTwilioCosts()).rejects.toThrow("account mismatch");
    expect((await stored()).provider_cost).toBeNull(); expect(await audits()).toHaveLength(0);
  });
  it.each([
    ["org_id", other], ["credential_fingerprint", "changed"], ["credential_source", "tenant"],
    ["provider_request_id", "SM" + "b".repeat(32)], ["provider", "Hunter"],
    ["billing_accepted", false], ["billing_status", "billed"], ["budget_cost", "0"],
    ["reserved_cost", "4"], ["outcome", "pending"], ["evidence", "different evidence"],
    ["invoice_reference", "in_synthetic"],
  ])("rejects a changed %s captured before lookup", async (column, value) => {
    fetchMock.mockImplementation(async () => {
      await state.db.query(`update api_usage_events set ${column}=$2 where id=$1`, [event, value]);
      return receipt();
    });
    await expect(syncTwilioCosts()).rejects.toThrow(/changed/);
    expect((await stored()).provider_cost).toBeNull(); expect(await audits()).toHaveLength(0);
  });
  it("never overwrites a subsequently known cost", async () => {
    fetchMock.mockImplementation(async () => {
      await state.db.query("update api_usage_events set provider_cost=2 where id=$1", [event]);
      return receipt();
    });
    await expect(syncTwilioCosts()).rejects.toThrow("cannot be overwritten");
    expect((await stored()).provider_cost).toBe("2.000000000000"); expect(await audits()).toHaveLength(0);
  });
  it("does not treat an equal cost with unverified evidence as its own committed receipt", async () => {
    fetchMock.mockImplementation(async () => {
      await state.db.query("update api_usage_events set provider_cost=1,evidence='Unverified' where id=$1", [event]);
      return receipt();
    });
    await expect(syncTwilioCosts()).rejects.toThrow("different evidence");
    expect(await audits()).toHaveLength(0);
  });
  it("rejects duplicated request ownership", async () => {
    await state.db.query(`insert into api_usage_events(id,org_id,provider,service,feature,credential_source,credential_fingerprint,provider_request_id)
      values($1,$2,'Twilio','sms','Synthetic duplicate','platform','different',$3)`, [randomUUID(), other, requestId]);
    await expect(syncTwilioCosts()).rejects.toThrow("Duplicate");
    expect((await stored()).provider_cost).toBeNull(); expect(await audits()).toHaveLength(0);
  });
  it("rolls back the cost when audit persistence fails", async () => {
    state.failAudit = true;
    await expect(syncTwilioCosts()).rejects.toThrow("synthetic audit failure");
    expect((await stored()).provider_cost).toBeNull(); expect(await audits()).toHaveLength(0);
  });
  it("rejects an invoice batch assigned while the lookup is in flight", async () => {
    fetchMock.mockImplementation(async () => {
      const batch = (await state.db.query("insert into api_usage_invoice_batches(org_id,exact_amount,amount_cents) values($1,1,100) returning id", [org])).rows[0].id;
      await state.db.query("update api_usage_events set batch_id=$2 where id=$1", [event, batch]);
      return receipt();
    });
    await expect(syncTwilioCosts()).rejects.toThrow("changed");
    expect((await stored()).provider_cost).toBeNull(); expect(await audits()).toHaveLength(0);
  });
  it.each(["1.00", "2"])("serializes simultaneous receipts with second cost %s", async secondCost => {
    const responses: ((r: Response) => void)[] = [];
    fetchMock.mockImplementation(() => new Promise<Response>(resolve => responses.push(resolve)));
    const first = syncTwilioCosts(); const second = syncTwilioCosts();
    const results = Promise.allSettled([first, second]);
    await vi.waitFor(() => expect(responses).toHaveLength(2));
    responses[0](receipt("1"));
    await vi.waitFor(async () => expect(await audits()).toHaveLength(1));
    responses[1](receipt(secondCost));
    const settled = await results;
    expect(settled[0]).toEqual({ status: "fulfilled", value: 1 });
    if (secondCost === "1.00") expect(settled[1]).toEqual({ status: "fulfilled", value: 0 });
    else expect(settled[1].status).toBe("rejected");
    expect((await stored()).provider_cost).toBe("1.000000000000"); expect(await audits()).toHaveLength(1);
  });
  it.each([["1", "1.00"], ["1", "2"], ["12345678901.123456789012", "12345678901.123456789013"], ["12345678901.123456789012", "12345678901.123456789012"]])("locks competing commits released together with costs %s / %s", async (firstCost, secondCost) => {
    const responses: ((r: Response) => void)[] = [];
    fetchMock.mockImplementation(() => new Promise<Response>(resolve => responses.push(resolve)));
    const results = Promise.allSettled([syncTwilioCosts(), syncTwilioCosts()]);
    await vi.waitFor(() => expect(responses).toHaveLength(2));
    responses[0](receipt(firstCost)); responses[1](receipt(secondCost));
    const settled = await results;
    expect(await audits()).toHaveLength(1);
    if (secondCost === "1.00" || firstCost === secondCost) {
      expect(settled.filter(r => r.status === "fulfilled").map(r => r.value).sort()).toEqual([0, 1]);
      expect((await stored()).provider_cost).toBe(firstCost === "1" ? "1.000000000000" : firstCost);
    } else {
      expect(settled.filter(r => r.status === "fulfilled")).toHaveLength(1);
      expect(settled.filter(r => r.status === "rejected")).toHaveLength(1);
      expect(firstCost === "1" ? ["1.000000000000", "2.000000000000"] : [firstCost, secondCost]).toContain((await stored()).provider_cost);
    }
  });
  it("an identical in-flight retry after invoicing acknowledges without changing the bill", async () => {
    const responses: ((r: Response) => void)[] = [];
    fetchMock.mockImplementation(() => new Promise<Response>(resolve => responses.push(resolve)));
    const first = syncTwilioCosts(); const retry = syncTwilioCosts();
    const results = Promise.all([first, retry]);
    await vi.waitFor(() => expect(responses).toHaveLength(2));
    responses[0](receipt());
    await vi.waitFor(async () => expect(await audits()).toHaveLength(1));
    await state.db.query("update api_usage_events set billing_status='billed',invoice_reference='in_synthetic' where id=$1", [event]);
    responses[1](receipt("1.0"));
    expect(await results).toEqual([1, 0]);
    expect((await stored()).billing_status).toBe("billed"); expect(await audits()).toHaveLength(1);
  });
  it("does not settle an orphan usage row without a tenant", async () => {
    await state.db.query("update api_usage_events set org_id=null where id=$1", [event]);
    expect(await syncTwilioCosts()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled(); expect(await audits()).toHaveLength(0);
    expect((await stored()).provider_cost).toBeNull();
  });
  it.each([null, "not-a-message"])("does not look up missing or invalid request ID %s", async id => {
    await state.db.query("update api_usage_events set provider_request_id=$2 where id=$1", [event, id]);
    expect(await syncTwilioCosts()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled(); expect(await audits()).toHaveLength(0);
  });
});
