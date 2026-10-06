import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const m = vi.hoisted(() => ({
  db: null as PGlite | null,
  classifyAt: "" as "" | "quote" | "package",
  enqueue: vi.fn(async () => "synthetic-job"),
}));
const ORG = "11111111-1111-4111-8111-111111111111";
const OPP = "22222222-2222-4222-8222-222222222222";
const SUB = "33333333-3333-4333-8333-333333333333";
vi.mock("@/lib/db", () => {
  const query = async (sql: string, args: unknown[] = []) => {
    if ((m.classifyAt === "quote" && /insert into quotes|update quotes q/.test(sql)) ||
        (m.classifyAt === "package" && /update bids set/.test(sql))) {
      await m.db!.exec("update opportunities set is_sources_sought=true");
    }
    return (await m.db!.query(sql, args)).rows;
  };
  return { query, queryOne: async (sql: string, args: unknown[]) => (await query(sql, args))[0] ?? null };
});
vi.mock("@/lib/org-guard", () => ({ requireOrgContext: async () => ({
  orgId: "11111111-1111-4111-8111-111111111111", user: { email: "operator@example.test" },
}) }));
vi.mock("@/lib/queue", () => ({ enqueue: m.enqueue }));
vi.mock("@/lib/ai/companyProfile", () => ({ getProfileJson: async () => null }));
vi.mock("@/lib/logger", () => ({ logAgent: async () => undefined }));
import { POST } from "@/app/api/opportunities/[id]/quote/route";

beforeAll(async () => {
  m.db = new PGlite();
  await m.db.exec(`
    create table opportunities(id uuid,org_id uuid,is_sources_sought boolean,stage text,status text,
      pursuit_state text,raw_json jsonb,human_action_required boolean);
    create table subcontractors(id uuid,org_id uuid);
    create table quotes(id uuid default gen_random_uuid(),org_id uuid,opportunity_id uuid,subcontractor_id uuid,
      trade text,quote_amount numeric,payment_terms text,notes text,is_out_of_range boolean,
      comparison_json jsonb,created_at timestamptz default now());
    create table bids(id uuid,org_id uuid,opportunity_id uuid,submission_state text,package_ready boolean,
      audit_status text,created_at timestamptz,updated_at timestamptz);
  `);
}, 30_000);
afterAll(async () => { await m.db?.close(); });
beforeEach(async () => {
  vi.clearAllMocks(); m.classifyAt = "";
  await m.db!.exec("truncate opportunities,subcontractors,quotes,bids");
  await m.db!.query("insert into opportunities values($1,$2,false,'outreach','open','active',null,true)", [OPP, ORG]);
  await m.db!.query("insert into subcontractors values($1,$2)", [SUB, ORG]);
  await m.db!.query("insert into bids values($1,$2,$1,'package_ready',true,'passed',now(),null)", [OPP, ORG]);
});
async function call(existing: boolean) {
  if (existing) await m.db!.query("insert into quotes(org_id,opportunity_id,subcontractor_id,trade,quote_amount) values($1,$2,$3,'Electrical',500)", [ORG, OPP, SUB]);
  return POST(new Request("http://local.test", { method: "POST", body: JSON.stringify({
    items: [{ trade: "Electrical", subcontractorId: SUB, quote_amount: 1000 }],
  }) }), { params: Promise.resolve({ id: OPP }) });
}

describe("direct quote writes preserve Sources Sought pricing history", () => {
  it.each([false, true])("refuses a research notice before an existing=%s quote write", async (existing) => {
    await m.db!.exec("update opportunities set is_sources_sought=true");
    const response = await call(existing);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/Sources Sought|market research/i);
    expect((await m.db!.query<{ quote_amount: string }>("select quote_amount from quotes")).rows.map(r => Number(r.quote_amount))).toEqual(existing ? [500] : []);
    expect(m.enqueue).not.toHaveBeenCalled();
  });
  it.each([false, true])("rechecks classification inside an existing=%s quote write", async (existing) => {
    m.classifyAt = "quote";
    const response = await call(existing);
    expect(response.status).toBe(409);
    expect((await m.db!.query<{ quote_amount: string }>("select quote_amount from quotes")).rows.map(r => Number(r.quote_amount))).toEqual(existing ? [500] : []);
    expect(m.enqueue).not.toHaveBeenCalled();
  });
  it("leaves package and stage history unchanged if classification changes after the quote saves", async () => {
    m.classifyAt = "package";
    const response = await call(false);
    expect(response.status).toBe(409);
    expect((await m.db!.query("select package_ready from bids")).rows[0].package_ready).toBe(true);
    expect((await m.db!.query("select stage,human_action_required from opportunities")).rows[0]).toEqual({ stage: "outreach", human_action_required: true });
    expect(m.enqueue).not.toHaveBeenCalled();
  });
  it.each([false, true])("still saves ordinary bid quotes, existing=%s", async (existing) => {
    expect((await call(existing)).status).toBe(200);
    expect((await m.db!.query<{ quote_amount: string }>("select quote_amount from quotes")).rows.map(r => Number(r.quote_amount))).toEqual([1000]);
    expect(m.enqueue).toHaveBeenCalledTimes(1);
  });
});
