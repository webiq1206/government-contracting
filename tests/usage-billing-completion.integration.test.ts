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
  notes: [] as any[],
  finalized: [] as any[],
}));
vi.mock("../lib/db", () => ({
  query: async (s: string, p: unknown[] = []) =>
    (await state.db.query(s, p)).rows,
  queryOne: async (s: string, p: unknown[] = []) =>
    (await state.db.query(s, p)).rows[0] ?? null,
  transaction: async (fn: any) =>
    state.db.transaction((tx: any) =>
      fn({
        query: async (s: string, p: unknown[] = []) =>
          s.includes("pg_advisory") ? { rows: [] } : tx.query(s, p),
      }),
    ),
}));
vi.mock("../lib/billing/stripe", () => ({
  getStripe: () => ({
    subscriptions: {
      retrieve: async () => ({
        id: "sub_test",
        items: {
          data: [
            {
              current_period_start: 1788220800,
              current_period_end: 1790812800,
            },
          ],
        },
      }),
    },
    invoices: {
      retrieve: async () => ({
        id: "in_test",
        status: "paid",
        amount_remaining: 0,
        metadata: {
          org_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          api_usage_batch: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        },
      }),
      finalizeInvoice: async (...a: any[]) => state.finalized.push(a),
    },
    refunds: { retrieve: async () => ({ status: "pending" }) },
    creditNotes: {
      retrieve: async () => ({
        id: "cn_test",
        invoice: "in_test",
        amount: 300,
        status: "issued",
        metadata: {
          org_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          api_usage_adjustment: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        },
        refunds: [{ refund: "re_test" }],
      }),
      create: async (...a: any[]) => {
        state.notes.push(a);
        return { id: "cn_" + a[1].idempotencyKey };
      },
    },
  }),
}));
vi.mock("../lib/api-usage/credentials", () => ({
  platformApiValue: async () => null,
}));
import {
  adjustUsageInvoice,
  syncBillingPeriod,
  syncUsageAdjustment,
} from "../lib/api-usage/billing";
import {
  reconcileReceipts,
  syncAnthropicCosts,
} from "../lib/api-usage/reconciliation";
const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const batch = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
beforeAll(async () => {
  state.db = new PGlite();
  await state.db.exec(
    "create table organizations(id uuid primary key,name text,stripe_customer_id text,stripe_subscription_id text); create function capture_activity() returns trigger language plpgsql as $$ begin return NEW; end $$",
  );
  for (const file of [
    "112_api_usage_ledger.sql",
    "115_usage_billing_completion.sql",
  ])
    await state.db.exec(readFileSync("db/migrations/" + file, "utf8"));
  await state.db.query(
    "insert into organizations(id,name,stripe_subscription_id) values($1,'One','sub_test'),($2,'Other','sub_other')",
    [org, other],
  );
  await state.db.query(
    "insert into api_usage_invoice_batches(id,org_id,exact_amount,amount_cents,status,stripe_invoice_id,stripe_item_id) values($1,$2,10,1000,'paid','in_test','ii_test')",
    [batch, org],
  );
}, 30000);
afterAll(async () => {
  await state.db.close();
});
beforeEach(() => {
  vi.unstubAllGlobals();
  state.notes = [];
});
describe("billing completion", () => {
  it("uses current item periods from Stripe", async () => {
    const p = await syncBillingPeriod(org);
    expect(p).toEqual({
      start: "2026-09-01T00:00:00.000Z",
      end: "2026-10-01T00:00:00.000Z",
    });
  });
  it("issues a real partial refund once and retains its audit record", async () => {
    const input = {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      orgId: org,
      batchId: batch,
      amountCents: 300,
      kind: "refund" as const,
      reason: "Duplicate service charge",
    };
    const a = await adjustUsageInvoice(input, "owner");
    const b = await adjustUsageInvoice(input, "owner");
    expect(a).toBe(b);
    expect(state.notes).toHaveLength(1);
    expect(state.notes[0][0].refund_amount).toBe(300);
    await expect(
      adjustUsageInvoice(
        {
          ...input,
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          amountCents: 800,
        },
        "owner",
      ),
    ).rejects.toThrow("remaining");
  });
  it("keeps pending refunds distinct from completed money movement", async () => {
    const result = await syncUsageAdjustment(
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    );
    expect(result).toBe("pending");
  });
  it("refuses cross-tenant adjustments", async () => {
    await expect(
      adjustUsageInvoice(
        {
          id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          orgId: other,
          batchId: batch,
          amountCents: 100,
          kind: "credit",
          reason: "Billing correction",
        },
        "owner",
      ),
    ).rejects.toThrow("finalized");
    expect(state.notes).toHaveLength(0);
  });
  it("reconciles exact receipts atomically and applies the markup in SQL", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    await state.db.query(
      "insert into api_usage_events(id,org_id,provider,service,feature,credential_source,credential_fingerprint,billing_accepted,provider_request_id) values($1,$2,'Hunter','search','Find contact','platform','hash',true,'req_1')",
      [id, org],
    );
    await expect(
      reconcileReceipts(
        [
          {
            id,
            provider: "Hunter",
            requestId: "wrong",
            cost: "1",
            evidence: "Provider invoice",
          },
        ],
        "owner",
      ),
    ).rejects.toThrow("match");
    await reconcileReceipts(
      [
        {
          id,
          provider: "Hunter",
          requestId: "req_1",
          cost: "0.0000008",
          evidence: "Provider invoice",
        },
      ],
      "owner",
    );
    const row = (
      await state.db.query(
        "select tenant_charge::text,billing_status from api_usage_events where id=$1",
        [id],
      )
    ).rows[0];
    expect(row.tenant_charge).toBe("0.000001000000");
    expect(row.billing_status).toBe("unbilled");
  });
  it("converts Anthropic cents exactly without attributing shared totals to tenants", async () => {
    process.env.ANTHROPIC_ADMIN_API_KEY = "test";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [
                {
                  starting_at: "2026-09-07T00:00:00Z",
                  ending_at: "2026-09-08T00:00:00Z",
                  results: [{ amount: "123.78912", currency: "USD" }],
                },
              ],
              has_more: false,
            }),
            { status: 200 },
          ),
      ),
    );
    await syncAnthropicCosts();
    const row = (
      await state.db.query(
        "select reported_cost::text from api_usage_provider_reports where provider='Anthropic'",
      )
    ).rows[0];
    expect(row.reported_cost).toBe("1.237891200000");
    delete process.env.ANTHROPIC_ADMIN_API_KEY;
  });
});
