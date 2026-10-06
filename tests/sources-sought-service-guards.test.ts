import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const m = vi.hoisted(() => ({ db: null as PGlite | null, classifyAtWrite: false }));
const ORG = "11111111-1111-4111-8111-111111111111";
const OPP = "22222222-2222-4222-8222-222222222222";
vi.mock("@/lib/db", () => {
  const query = async (sql: string, args: unknown[] = []) => {
    if (m.classifyAtWrite && (/with upserted as/.test(sql) || /update bids\s/.test(sql))) {
      await m.db!.exec("update opportunities set is_sources_sought=true");
    }
    return (await m.db!.query(sql, args)).rows;
  };
  return { query, queryOne: async (sql: string, args: unknown[]) => (await query(sql, args))[0] ?? null, transaction: vi.fn() };
});
vi.mock("@/lib/data", () => ({ currentOrg: async () => "11111111-1111-4111-8111-111111111111" }));
vi.mock("@/lib/ai/companyProfile", () => ({ getProfileJson: async () => null }));
vi.mock("@/lib/integrations/storage", () => ({ storage: {} }));
import { updateRequirement } from "@/lib/requirement-states";
import { applyPackageChange } from "@/lib/bid-package-state";

beforeAll(async () => {
  m.db = new PGlite();
  await m.db.exec(`
    create table opportunities(id uuid,org_id uuid,is_sources_sought boolean,title text,agency text,naics_code text,
      set_aside_type text,location_text text,location_state text,solicitation_number text,solicitation_analysis jsonb);
    create table users(id uuid,name text,email text);
    create table requirement_states(org_id uuid,opportunity_id uuid,requirement_id text,state text,verification text,
      human_verified boolean,owner_id uuid,due_at timestamptz,blocking_reason text,note text,updated_at timestamptz,
      updated_by uuid,unique(opportunity_id,requirement_id));
    create table requirement_state_events(org_id uuid,opportunity_id uuid,requirement_id text,from_state text,to_state text,
      actor_kind text,actor_id uuid,actor_label text,note text);
    create table bids(id uuid,org_id uuid,opportunity_id uuid,compliance_matrix jsonb,audit_findings jsonb,
      bid_amount numeric,sub_quote_total numeric,markup_pct numeric,documents_json jsonb,submission_state text,
      requirements_fingerprint text,created_at timestamptz,updated_at timestamptz,package_ready boolean,
      validation_json jsonb,package_manifest jsonb);
    create table documents(opportunity_id uuid,org_id uuid,kind text);
  `);
}, 30_000);
afterAll(async () => { await m.db?.close(); });
beforeEach(async () => {
  m.classifyAtWrite = false;
  await m.db!.exec("truncate opportunities,requirement_states,requirement_state_events,bids,documents");
  await m.db!.query("insert into opportunities(id,org_id,is_sources_sought,title) values($1,$2,false,'Synthetic notice')", [OPP, ORG]);
  await m.db!.query(`insert into bids(id,org_id,opportunity_id,compliance_matrix,audit_findings,documents_json,
    submission_state,created_at,package_ready) values($1,$2,$1,'[]','[]','[]','package_ready',now(),true)`, [OPP, ORG]);
});

describe("research classification is rechecked at saved-history write boundaries", () => {
  it("does not save checklist progress if the notice becomes research after it was read", async () => {
    m.classifyAtWrite = true;
    const result = await updateRequirement(OPP, "req-1", { state: "in_progress" }, { kind: "person", label: "Synthetic operator" });
    expect(result.ok).toBe(false);
    expect((await m.db!.query("select * from requirement_states")).rows).toHaveLength(0);
    expect((await m.db!.query("select * from requirement_state_events")).rows).toHaveLength(0);
  });
  it("does not rewrite package findings if the notice becomes research after it was read", async () => {
    m.classifyAtWrite = true;
    const result = await applyPackageChange(OPP, ORG, ({ matrix }) => ({ matrix, findings: [] }));
    expect(result.ok).toBe(false);
    expect((await m.db!.query<{ updated_at: string | null }>("select updated_at from bids")).rows[0].updated_at).toBeNull();
  });
});
