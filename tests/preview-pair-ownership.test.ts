import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
const m = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: m.query, queryOne: vi.fn() }));
vi.mock("@/lib/org-guard", () => ({ requireOrgContext: async () => ({ orgId: "our-org" }) }));
vi.mock("@/lib/ai/companyProfile", () => ({ getProfileJson: vi.fn() }));
import { GET } from "@/app/api/templates/preview-context/route";
const db = new PGlite();
beforeAll(async () => {
  await db.exec(`
    create table opportunities(id text, org_id text, title text, status text, created_at timestamptz default now(), solicitation_analysis jsonb, is_sources_sought boolean default false);
    create table subcontractors(id text, org_id text, company_name text, email text, trade_categories text[]);
    create table opportunity_subs(opportunity_id text, subcontractor_id text, trade text, removed_at timestamptz);
  `);
  m.query.mockImplementation(async (sql: string, params: unknown[]) => (await db.query(sql, params)).rows);
});
beforeEach(async () => {
  await db.exec(`
    delete from opportunity_subs; delete from opportunities; delete from subcontractors;
    insert into opportunities(id,org_id,title,status) values('opp','our-org','Bid','open');
    insert into subcontractors values('foreign','other-org','Other tenant contact','foreign@example.com','{}'),
      ('ours','our-org','Our contact','ours@example.com','{}'),
      ('removed','our-org','Removed contact','removed@example.com','{}'),
      ('blank','our-org','Blank email','   ','{}');
    insert into opportunity_subs values('opp','foreign','HVAC',null),('opp','removed','HVAC',now()),('opp','ours','HVAC',null),('opp','blank','HVAC',null);
  `);
});
afterAll(() => db.close());
it("only offers active same-account pairs that its detail lookup can load", async () => {
  const result = await GET(new Request("https://brostco.com/api/templates/preview-context?list=1"));
  const data = await result.json();
  expect(data.synthesized).toBe(false);
  expect(data.pairings).toHaveLength(1);
  expect(data.pairings[0].subcontractor_id).toBe("ours");
});

it("never invents unrelated firms when no saved bid associations exist", async () => {
  await db.exec("delete from opportunity_subs");
  const result = await GET(new Request("https://brostco.com/api/templates/preview-context?list=1"));
  const data = await result.json();
  expect(data.pairings).toEqual([]);
  expect(data.synthesized).toBe(false);
});
it("does not offer Sources Sought as a real bid pricing request", async () => {
  await db.exec(`update opportunities set is_sources_sought=true where id='opp'`);
  const result = await GET(new Request("https://brostco.com/api/templates/preview-context?list=1"));
  expect((await result.json()).pairings).toEqual([]);
});
