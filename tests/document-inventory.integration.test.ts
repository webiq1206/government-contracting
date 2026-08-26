/**
 * The inventory columns are only worth anything if the database enforces them.
 *
 * Every one of these rules could have been written in the API instead, and
 * every one of them would then have been routable around by the next caller
 * that forgot. The rule that matters most is the exclusion reason: an
 * exclusion with a reason is a decision somebody can argue with, and an
 * exclusion without one is indistinguishable from a file that was quietly
 * lost. That is the exact state this inventory exists to make impossible, so
 * it is a constraint rather than a convention.
 *
 * Run against a real database because a check constraint that is not there
 * looks identical, from application code, to one that is.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

const LIVE = !!process.env.DATABASE_URL && !!process.env.ALLOW_TESTS_AGAINST_DATABASE_URL;
const d = LIVE ? describe : describe.skip;

d("document inventory constraints", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;

  const orgId = randomUUID();
  let oppId = "";

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    await query(
      `insert into organizations (id, name, subscription_status, billing_exempt)
       values ($1,'Inventory probe','active',true) on conflict (id) do nothing`,
      [orgId]
    );
    const opp = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, title, source, stage)
       values ($1,'Inventory probe opportunity','sam','analysis') returning id`,
      [orgId]
    );
    oppId = opp!.id;
  });

  afterAll(async () => {
    await query(`delete from documents where opportunity_id=$1`, [oppId]);
    await query(`delete from opportunities where id=$1`, [oppId]);
    await query(`delete from organizations where id=$1`, [orgId]);
  });

  const insert = (cols: string, vals: unknown[], extra = "") =>
    query(
      `insert into documents (org_id, opportunity_id, kind, name${cols ? ", " + cols : ""})
       values ($1,$2,'solicitation',$3${extra})`,
      [orgId, oppId, `probe-${randomUUID().slice(0, 8)}`, ...vals]
    );

  it("defaults a new row to blocked and pending, not to delivered", async () => {
    /*
     * The fail-closed half. A row that nobody got round to classifying must
     * read as "somebody has to look at this", never as "read in full". The
     * default is the whole reason existing rows written before this migration
     * cannot silently claim to have been extracted.
     */
    await insert("", []);
    const row = await queryOne<{ disposition: string; extraction_state: string }>(
      `select disposition, extraction_state from documents
       where opportunity_id=$1 order by created_at desc limit 1`,
      [oppId]
    );
    expect(row?.disposition).toBe("blocked");
    expect(row?.extraction_state).toBe("pending");
  });

  it("refuses an exclusion that gives no reason", async () => {
    await expect(insert("disposition", ["excluded"], ",$4")).rejects.toThrow(
      /documents_excluded_reason_ck/
    );
    await expect(
      insert("disposition, excluded_reason", ["excluded", "   "], ",$4,$5")
    ).rejects.toThrow(/documents_excluded_reason_ck/);
  });

  it("accepts an exclusion that gives one", async () => {
    await expect(
      insert(
        "disposition, excluded_reason, excluded_by",
        ["excluded", "Duplicate of Attachment 2.", "info@webiq.co"],
        ",$4,$5,$6"
      )
    ).resolves.toBeDefined();
  });

  it("refuses a disposition that is not one of the four", async () => {
    await expect(insert("disposition", ["probably_fine"], ",$4")).rejects.toThrow(
      /documents_disposition_ck/
    );
  });

  it("refuses an extraction state outside the list", async () => {
    await expect(insert("extraction_state", ["mostly"], ",$4")).rejects.toThrow(
      /documents_extraction_state_ck/
    );
  });

  it("keeps the superseded document rather than deleting it", async () => {
    // History is the point. An amendment replacing a document must leave the
    // document it replaced readable, because "what changed" is a question an
    // operator asks after the fact.
    const older = await queryOne<{ id: string }>(
      `insert into documents (org_id, opportunity_id, kind, name, disposition, extraction_state,
                              document_class, amendment_number)
       values ($1,$2,'solicitation','Wage Determination.pdf','delivered','extracted','wage_determination',null)
       returning id`,
      [orgId, oppId]
    );
    const newer = await queryOne<{ id: string }>(
      `insert into documents (org_id, opportunity_id, kind, name, disposition, extraction_state,
                              document_class, amendment_number)
       values ($1,$2,'solicitation','Amendment 0002.pdf','delivered','extracted','amendment',2)
       returning id`,
      [orgId, oppId]
    );
    await query(`update documents set superseded_by=$2 where id=$1`, [older!.id, newer!.id]);

    const still = await queryOne<{ superseded_by: string }>(
      `select superseded_by from documents where id=$1`,
      [older!.id]
    );
    expect(still?.superseded_by).toBe(newer!.id);

    // And deleting the replacement must not take the history with it.
    await query(`delete from documents where id=$1`, [newer!.id]);
    const orphaned = await queryOne<{ id: string; superseded_by: string | null }>(
      `select id, superseded_by from documents where id=$1`,
      [older!.id]
    );
    expect(orphaned?.id).toBe(older!.id);
    expect(orphaned?.superseded_by).toBeNull();
  });

  it("answers the question the inventory exists for in one query", async () => {
    /*
     * "Is there anything in this bid I have not seen." Before the migration
     * there was no column that could be asked, so the answer came from
     * counting rows, which counted a file dropped for want of room in the
     * prompt exactly the same as one read cover to cover.
     */
    const marker = `q-${randomUUID().slice(0, 8)}`;
    await query(
      `insert into documents (org_id, opportunity_id, kind, name, disposition, extraction_state)
       values ($1,$2,'solicitation',$3,'delivered','extracted'),
              ($1,$2,'solicitation',$4,'delivered','not_read'),
              ($1,$2,'solicitation',$5,'blocked','pending')`,
      [orgId, oppId, `${marker}-read`, `${marker}-notread`, `${marker}-blocked`]
    );
    const unresolved = await query<{ name: string }>(
      `select name from documents
       where opportunity_id=$1 and name like $2
         and (disposition <> 'delivered' or extraction_state <> 'extracted')
       order by name`,
      [oppId, `${marker}%`]
    );
    expect(unresolved.map((r) => r.name)).toEqual([`${marker}-blocked`, `${marker}-notread`]);
  });
});
