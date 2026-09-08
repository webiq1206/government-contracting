/**
 * Database tenant guards against a real, disposable PostgreSQL database.
 *
 * These checks exercise the final database boundary directly. They do not
 * depend on a route remembering an org_id predicate or on a service method
 * receiving the right tenant from its caller.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("database tenant relationship guards (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let transaction: typeof import("../lib/db").transaction;

  const orgA = randomUUID();
  const orgB = randomUUID();
  const oppA = randomUUID();
  const subA = randomUUID();
  const subB = randomUUID();
  const competitorA = randomUUID();
  const competitorB = randomUUID();

  beforeAll(async () => {
    ({ query, queryOne, transaction } = await import("../lib/db"));
    await query(
      `insert into organizations (id, name, subscription_status, billing_exempt)
       values ($1,$2,'active',true), ($3,$4,'active',true)`,
      [orgA, `tenant-guard-a-${orgA}`, orgB, `tenant-guard-b-${orgB}`]
    );
    await query(
      `insert into opportunities (id, org_id, source, title, stage, status)
       values ($1,$2,'test','Tenant guard opportunity','monitoring','open')`,
      [oppA, orgA]
    );
    await query(
      `insert into subcontractors (id, org_id, company_name)
       values ($1,$2,'Tenant Guard Sub A'), ($3,$4,'Tenant Guard Sub B')`,
      [subA, orgA, subB, orgB]
    );
  });

  afterAll(async () => {
    await query(`delete from backlink_outreach where org_id = any($1::uuid[])`, [[orgA, orgB]]).catch(
      () => {}
    );
    await query(`delete from backlinks where org_id = any($1::uuid[])`, [[orgA, orgB]]).catch(
      () => {}
    );
    await query(`delete from backlink_prospects where org_id = any($1::uuid[])`, [[orgA, orgB]]).catch(
      () => {}
    );
    await query(`delete from backlink_competitors where org_id = any($1::uuid[])`, [[orgA, orgB]]).catch(
      () => {}
    );
    await query(`delete from opportunity_subs where org_id = any($1::uuid[])`, [[orgA, orgB]]).catch(
      () => {}
    );
    await query(`delete from quotes where org_id = any($1::uuid[])`, [[orgA, orgB]]).catch(
      () => {}
    );
    await query(`delete from opportunities where org_id = any($1::uuid[])`, [[orgA, orgB]]).catch(
      () => {}
    );
    await query(`delete from subcontractors where org_id = any($1::uuid[])`, [[orgA, orgB]]).catch(
      () => {}
    );
    await query(`delete from organizations where id = any($1::uuid[])`, [[orgA, orgB]]).catch(
      () => {}
    );
    const { closePool } = await import("../lib/db");
    await closePool().catch(() => {});
  });

  it("derives the organization for a valid pairing", async () => {
    const row = await queryOne<{ id: string; org_id: string }>(
      `insert into opportunity_subs (opportunity_id, subcontractor_id, trade)
       values ($1,$2,'Electrical') returning id, org_id`,
      [oppA, subA]
    );
    expect(row?.org_id).toBe(orgA);
  });

  it("rejects a pairing whose opportunity and subcontractor belong to different tenants", async () => {
    await expect(
      query(
        `insert into opportunity_subs (opportunity_id, subcontractor_id, trade)
         values ($1,$2,'Plumbing')`,
        [oppA, subB]
      )
    ).rejects.toMatchObject({ code: "23514", constraint: "tenant_reference_guard" });
  });

  it("rejects an explicitly misowned child even when both referenced ids exist", async () => {
    await expect(
      query(
        `insert into quotes (org_id, opportunity_id, subcontractor_id, trade, quote_amount)
         values ($1,$2,$3,'Electrical',1000)`,
        [orgB, oppA, subA]
      )
    ).rejects.toMatchObject({ code: "23514", constraint: "tenant_reference_guard" });
  });

  it("rejects tenant reassignment of an existing record", async () => {
    await expect(
      query(`update opportunities set org_id=$2 where id=$1`, [oppA, orgB])
    ).rejects.toMatchObject({ code: "23514", constraint: "tenant_ownership_immutable" });
  });

  it("does not let a caller-defined custom setting bypass tenant immutability", async () => {
    await expect(
      transaction(async (client) => {
        await client.query("set local brostco.allow_tenant_reassignment = 'on'");
        await client.query(`update opportunities set org_id=$2 where id=$1`, [oppA, orgB]);
      })
    ).rejects.toMatchObject({ code: "23514", constraint: "tenant_ownership_immutable" });
  });

  it("allows org_id to clear only as part of an actual owning-organization deletion", async () => {
    const retainedOrg = randomUUID();
    const eventId = randomUUID();
    await query(
      `insert into organizations (id, name, subscription_status, billing_exempt)
       values ($1,$2,'active',true)`,
      [retainedOrg, `tenant-guard-delete-${retainedOrg}`]
    );
    await query(
      `insert into analytics_events (id, org_id, event) values ($1,$2,'tenant_guard_probe')`,
      [eventId, retainedOrg]
    );

    await expect(
      query(`update analytics_events set org_id=null where id=$1`, [eventId])
    ).rejects.toMatchObject({ code: "23514", constraint: "tenant_ownership_immutable" });

    await query(`delete from organizations where id=$1`, [retainedOrg]);
    const retained = await queryOne<{ org_id: string | null }>(
      `select org_id from analytics_events where id=$1`,
      [eventId]
    );
    expect(retained?.org_id).toBeNull();
    await query(`delete from analytics_events where id=$1`, [eventId]);
  });

  it("rejects a new core record with no tenant owner", async () => {
    await expect(
      query(`insert into opportunities (source, title) values ('test','Unowned probe')`)
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("lets two tenants track the same backlink domain independently", async () => {
    const rows = await query<{ id: string }>(
      `insert into backlink_competitors (id, org_id, domain, source)
       values ($1,$2,'shared-domain.invalid','operator'),
              ($3,$4,'shared-domain.invalid','operator')
       returning id`,
      [competitorA, orgA, competitorB, orgB]
    );
    expect(rows).toHaveLength(2);
  });

  it("rejects a backlink prospect attached to another tenant's competitor", async () => {
    await expect(
      query(
        `insert into backlink_prospects
           (org_id, domain, opportunity_type, competitor_id, status)
         values ($1,'prospect.invalid','competitor_gap',$2,'qualified')`,
        [orgB, competitorA]
      )
    ).rejects.toMatchObject({ code: "23514", constraint: "tenant_reference_guard" });
  });
});
