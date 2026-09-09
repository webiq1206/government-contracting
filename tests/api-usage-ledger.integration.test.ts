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
    "truncate api_usage_events,api_usage_invoice_batches,api_usage_limits,api_usage_rates,api_usage_preferences,platform_key_usage,integration_settings",
  );
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
  expect(data.rows).toHaveLength(50);
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
