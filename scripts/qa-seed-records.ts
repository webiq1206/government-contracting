/**
 * Dev-only: insert one sample opportunity + subcontractor for visual QA.
 * Usage: npx tsx scripts/qa-seed-records.ts
 */
import { randomUUID } from "node:crypto";
import { closePool, query, queryOne } from "../lib/db";

async function main() {
  const org = await queryOne<{ id: string }>(
    `select o.id
       from organizations o
       join organization_members m on m.org_id = o.id
      where o.subscription_status in ('active','trialing')
      order by o.created_at asc nulls last
      limit 1`
  );
  if (!org) throw new Error("No active organization found. Run scripts/qa-session.ts first.");

  const oppCols = await query<{ column_name: string }>(
    `select column_name from information_schema.columns
      where table_schema='public' and table_name='opportunities'`
  );
  const oppHasOrg = oppCols.some((c) => c.column_name === "org_id");

  let opp = await queryOne<{ id: string }>(
    oppHasOrg
      ? `select id from opportunities where org_id = $1 order by created_at desc limit 1`
      : `select id from opportunities order by created_at desc limit 1`,
    oppHasOrg ? [org.id] : []
  );

  if (!opp) {
    const id = randomUUID();
    const sourceId = `qa-${id.slice(0, 8)}`;
    const deadline = new Date(Date.now() + 5 * 86400000).toISOString();
    if (oppHasOrg) {
      await query(
        `insert into opportunities (
           id, org_id, source, source_id, title, agency, solicitation_number,
           stage, status, score, tier, deadline, value_estimated,
           human_action_required, raw_json, attachments_json
         ) values (
           $1,$2,'manual',$3,$4,$5,$6,
           'review','open',62,'review',$7,250000,
           true,'{}'::jsonb,'[]'::jsonb
         )`,
        [id, org.id, sourceId, "QA Facility Maintenance Support", "GSA", "QA-SOL-001", deadline]
      );
    } else {
      await query(
        `insert into opportunities (
           id, source, source_id, title, agency, solicitation_number,
           stage, status, score, tier, deadline, value_estimated,
           human_action_required, raw_json, attachments_json
         ) values (
           $1,'manual',$2,$3,$4,$5,
           'review','open',62,'review',$6,250000,
           true,'{}'::jsonb,'[]'::jsonb
         )`,
        [id, sourceId, "QA Facility Maintenance Support", "GSA", "QA-SOL-001", deadline]
      );
    }
    opp = { id };
    console.log("seeded_opportunity");
  } else {
    console.log("opportunity_exists");
  }

  const subCols = await query<{ column_name: string }>(
    `select column_name from information_schema.columns
      where table_schema='public' and table_name='subcontractors'`
  );
  const subHasOrg = subCols.some((c) => c.column_name === "org_id");

  let sub = await queryOne<{ id: string }>(
    subHasOrg
      ? `select id from subcontractors where org_id = $1 order by created_at desc limit 1`
      : `select id from subcontractors order by created_at desc limit 1`,
    subHasOrg ? [org.id] : []
  );

  if (!sub) {
    const id = randomUUID();
    if (subHasOrg) {
      await query(
        `insert into subcontractors (
           id, org_id, company_name, trade_categories, state, city, reliability_score
         ) values ($1,$2,$3,$4::text[],$5,$6,$7)`,
        [id, org.id, "QA Electrical Pros LLC", ["Electrical"], "TX", "Austin", 72]
      );
    } else {
      await query(
        `insert into subcontractors (
           id, company_name, trade_categories, state, city, reliability_score
         ) values ($1,$2,$3::text[],$4,$5,$6)`,
        [id, "QA Electrical Pros LLC", ["Electrical"], "TX", "Austin", 72]
      );
    }
    sub = { id };
    console.log("seeded_subcontractor");
  } else {
    console.log("subcontractor_exists");
  }

  console.log("opportunity_id=" + opp.id);
  console.log("sub_id=" + sub.id);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => closePool());
