import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
const state = vi.hoisted(() => ({ db: null as PGlite | null }));
vi.mock("@/lib/db", () => ({ queryOne: async (sql: string, values: unknown[]) =>
  (await state.db!.query(sql, values)).rows[0] ?? null }));
import { unavailableSubcontractorLinks } from "@/lib/opportunity-sub-scope";

describe("historical subcontractor link availability", () => {
  beforeAll(async () => {
    state.db = new PGlite();
    // Deliberately model pre-guard legacy rows, including null ownership.
    // No production constraint is disabled or data migration performed.
    await state.db.exec(`
      create table opportunities(id text primary key, org_id text);
      create table subcontractors(id text primary key, org_id text, company_name text);
      create table opportunity_subs(id text primary key, opportunity_id text, subcontractor_id text, removed_at timestamptz);
      insert into opportunities values ('mine','a'),('theirs','b');
      insert into subcontractors values ('owned','a','My firm'),('unowned',null,'Unowned private firm'),('foreign','b','Foreign private firm');
      insert into opportunity_subs values
        ('valid','mine','owned',null), ('legacy','mine','unowned',null),
        ('cross','mine','foreign',null), ('dangling','mine','missing',null),
        ('removed','mine','unowned',now()), ('other','theirs','unowned',null);
    `);
  }, 60000);
  afterAll(async () => { await state.db?.close(); });

  it("counts unavailable active links without exposing records or counting removed history", async () => {
    expect(await unavailableSubcontractorLinks("mine", "a")).toBe(3);
    const before = await state.db!.query("select * from opportunity_subs order by id");
    await unavailableSubcontractorLinks("mine", "a");
    expect((await state.db!.query("select * from opportunity_subs order by id")).rows).toEqual(before.rows);
    expect((await state.db!.query("select org_id from subcontractors where id='unowned'")).rows).toEqual([{ org_id: null }]);
  });
  it("cannot reveal link counts on another tenant's opportunity or a missing record", async () => {
    expect(await unavailableSubcontractorLinks("theirs", "a")).toBe(0);
    expect(await unavailableSubcontractorLinks("mine", "b")).toBe(0);
    expect(await unavailableSubcontractorLinks("missing", "a")).toBe(0);
    expect(await unavailableSubcontractorLinks("theirs", "b")).toBe(1);
  });
});
