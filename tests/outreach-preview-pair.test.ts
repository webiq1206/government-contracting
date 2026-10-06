import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const m = vi.hoisted(() => ({ one: vi.fn() }));
vi.mock("@/lib/db", () => ({ queryOne: m.one }));
import { loadOutreachPreviewPair } from "@/lib/outreach-preview";

const db = new PGlite();
beforeAll(async () => {
  await db.exec(`
    create table opportunities(id text, org_id text, status text, is_sources_sought boolean);
    create table subcontractors(id text, org_id text);
    create table opportunity_subs(opportunity_id text, subcontractor_id text, trade text,
      removed_at timestamptz, created_at timestamptz default now());
    insert into opportunities values ('bid','ours','open',false),('research','ours','open',true),
      ('closed','ours','archived',false),('foreign','theirs','open',false);
    insert into subcontractors values ('contact','ours'),('unrelated','ours'),('foreign','theirs');
    insert into opportunity_subs(opportunity_id,subcontractor_id,trade,removed_at) values
      ('bid','contact','Electrical',null),('bid','contact',null,null),('bid','contact','HVAC',now()),
      ('research','contact','Electrical',null),('closed','contact','Electrical',null),
      ('bid','foreign','Electrical',null);
  `);
  m.one.mockImplementation(async (sql: string, params: unknown[]) =>
    (await db.query(sql, params)).rows[0] ?? null);
});
afterAll(() => db.close());

it("resolves only the trade recorded on a saved same-account association", async () => {
  const result = await loadOutreachPreviewPair("ours", {
    opportunityId: "bid", subcontractorId: "contact", trade: "Electrical",
  });
  expect(result.trade).toBe("Electrical");
});
it("does not replace the no-trade association with a named trade", async () => {
  for (const trade of [null, undefined, ""]) {
    const result = await loadOutreachPreviewPair("ours", { opportunityId: "bid", subcontractorId: "contact", trade });
    expect(result.trade).toBeNull();
  }
});
it.each([
  ["bid", "unrelated", "Electrical", "no active saved association"],
  ["bid", "contact", "HVAC", "no active saved association"],
  ["bid", "contact", "Catering", "no active saved association"],
  ["research", "contact", "Electrical", "Sources Sought"],
  ["closed", "contact", "Electrical", "closed record"],
  ["foreign", "contact", "Electrical", "could not be found on this account"],
  ["bid", "foreign", "Electrical", "could not be found on this account"],
])("refuses invalid preview %s / %s / %s", async (opportunityId, subcontractorId, trade, message) => {
  await expect(loadOutreachPreviewPair("ours", { opportunityId, subcontractorId, trade })).rejects.toThrow(message);
});
