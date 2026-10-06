import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const m = vi.hoisted(() => ({ db: null as PGlite | null }));
const ORG = "11111111-1111-4111-8111-111111111111";
const OPP = "22222222-2222-4222-8222-222222222222";
vi.mock("@/lib/db", () => ({
  query: async (sql: string, args: unknown[]) => (await m.db!.query(sql, args)).rows,
  queryOne: async (sql: string, args: unknown[]) => (await m.db!.query(sql, args)).rows[0] ?? null,
}));
vi.mock("@/lib/org-guard", () => ({ requireOrgContext: async () => ({
  orgId: "11111111-1111-4111-8111-111111111111", user: { email: "operator@example.test" },
}) }));
vi.mock("@/lib/pricing-rows", () => ({
  savePricingRow: async () => {
    await m.db!.exec("update opportunities set is_sources_sought=true");
    return { trade: "Electrical" };
  },
  deletePricingRow: async () => {
    await m.db!.exec("update opportunities set is_sources_sought=true");
    return true;
  },
  pricingRowsWithQuotes: async () => [],
  PricingRowRejected: class extends Error {},
}));
// The common queue gate refuses after the notice classification changes.
vi.mock("@/lib/queue", () => ({ enqueue: async () => null }));
vi.mock("@/lib/logger", () => ({ logAgent: async () => undefined }));
import { PUT, DELETE } from "@/app/api/opportunities/[id]/pricing/route";

beforeAll(async () => {
  m.db = new PGlite();
  await m.db.exec(`
    create table opportunities(id uuid,org_id uuid,is_sources_sought boolean,stage text,status text,
      pursuit_state text,human_action_required boolean);
    create table bids(id uuid,org_id uuid,opportunity_id uuid,submission_state text,package_ready boolean,
      audit_status text,created_at timestamptz,updated_at timestamptz);
  `);
}, 30_000);
afterAll(async () => { await m.db?.close(); });
beforeEach(async () => {
  await m.db!.exec("truncate opportunities,bids");
  await m.db!.query("insert into opportunities values($1,$2,false,'quote_entry','open','active',false)", [OPP, ORG]);
  await m.db!.query("insert into bids values($1,$2,$1,'package_ready',true,'passed',now(),null)", [OPP, ORG]);
});

describe("pricing rebuild side effects preserve research history", () => {
  it.each([["save", PUT], ["delete", DELETE]] as const)("does not alter package or attention flags after a pricing %s changes classification", async (_name, handler) => {
    const response = await handler(new Request("http://local.test", {
      method: "POST", body: JSON.stringify({ trade: "Electrical", baseQuote: 1000 }),
    }), { params: Promise.resolve({ id: OPP }) });
    expect((await response.json()).rebuildQueued).toBe(false);
    expect((await m.db!.query("select package_ready,audit_status,updated_at from bids")).rows[0]).toEqual({
      package_ready: true, audit_status: "passed", updated_at: null,
    });
    expect((await m.db!.query("select human_action_required from opportunities")).rows[0].human_action_required).toBe(false);
  });
});
