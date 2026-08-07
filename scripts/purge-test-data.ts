/**
 * Find (and optionally remove) test/dummy records before going live.
 *
 *   npm run purge-test-data              # DRY RUN: lists what would be removed
 *   npm run purge-test-data -- --delete  # actually removes it
 *
 * What counts as test data (deliberately narrow, pattern-based):
 *   - opportunities whose source_id starts with TEST- / QA- / QA2- / QA3- /
 *     E2E- (the prefixes used by development test cycles). Real SAM.gov
 *     notice ids never look like this.
 *   - subcontractors with reserved-fictional contact info: an email on a
 *     .example / example.com domain, or a 555-01xx phone number.
 *
 * Deleting an opportunity cascades to its quotes, bids, documents, call
 * cards, communications, and sub pairings. Contracts do NOT cascade (they
 * are part of the business record), so matched test contracts are removed
 * explicitly, and only when they belong to a matched test opportunity.
 * Nothing outside the listed matches is ever touched.
 */
import "../lib/env";
import { query, pool } from "../lib/db";

const DELETE = process.argv.includes("--delete");

const OPP_PATTERN = "^(TEST|QA[0-9]*|E2E)-";

async function main() {
  const opps = await query<{
    id: string;
    source_id: string | null;
    title: string | null;
    stage: string;
    status: string;
    bids: number;
    contracts: number;
  }>(
    `select o.id, o.source_id, o.title, o.stage, o.status,
            (select count(*)::int from bids b where b.opportunity_id = o.id) as bids,
            (select count(*)::int from contracts c where c.opportunity_id = o.id) as contracts
       from opportunities o
      where o.source_id ~ $1
      order by o.created_at`,
    [OPP_PATTERN]
  );

  const subs = await query<{
    id: string;
    company_name: string;
    email: string | null;
    phone: string | null;
  }>(
    `select id, company_name, email, phone
       from subcontractors
      where email ~* '@([a-z0-9-]+\\.)*example(\\.[a-z]+)?$'
         or email ilike '%.example'
         or phone like '%555-01%'
      order by company_name`
  );

  console.log("=".repeat(64));
  console.log(DELETE ? "PURGE TEST DATA (deleting)" : "PURGE TEST DATA (dry run, nothing deleted)");
  console.log("=".repeat(64));

  if (opps.length === 0 && subs.length === 0) {
    console.log("\nNo test data found. The database looks clean. ✓");
    return;
  }

  if (opps.length > 0) {
    console.log(`\nTest opportunities (${opps.length}):`);
    for (const o of opps) {
      console.log(
        `  - [${o.source_id}] "${o.title ?? "(untitled)"}" · ${o.stage}/${o.status}` +
          (o.bids ? ` · ${o.bids} bid(s)` : "") +
          (o.contracts ? ` · ${o.contracts} contract(s)` : "")
      );
    }
    console.log(
      "    (deleting also removes their quotes, bids, documents, call cards,\n" +
        "     communications, and sub pairings via cascade)"
    );
  }

  if (subs.length > 0) {
    console.log(`\nTest subcontractors (${subs.length}):`);
    for (const s of subs) {
      console.log(`  - ${s.company_name} · ${s.email ?? "no email"} · ${s.phone ?? "no phone"}`);
    }
  }

  if (!DELETE) {
    console.log(
      "\nDry run only. Review the list above, then run:\n  npm run purge-test-data -- --delete"
    );
    return;
  }

  // --- Deletion, narrowest first. ---
  const oppIds = opps.map((o) => o.id);
  if (oppIds.length > 0) {
    const delContracts = await query<{ id: string }>(
      `delete from contracts where opportunity_id = any($1::uuid[]) returning id`,
      [oppIds]
    );
    const delLogs = await query<{ id: string }>(
      `delete from agent_logs where opportunity_id = any($1::uuid[]) returning id`,
      [oppIds]
    );
    const delOpps = await query<{ id: string }>(
      `delete from opportunities where id = any($1::uuid[]) returning id`,
      [oppIds]
    );
    console.log(
      `\nDeleted ${delOpps.length} opportunit${delOpps.length === 1 ? "y" : "ies"}, ` +
        `${delContracts.length} contract(s), ${delLogs.length} related log entr${delLogs.length === 1 ? "y" : "ies"} (+ cascaded children).`
    );
  }
  if (subs.length > 0) {
    const delSubs = await query<{ id: string }>(
      `delete from subcontractors where id = any($1::uuid[]) returning id`,
      [subs.map((s) => s.id)]
    );
    console.log(`Deleted ${delSubs.length} test subcontractor(s).`);
  }
  console.log("\nDone. The pipeline now contains only real records. ✓");
}

main()
  .catch((err) => {
    console.error("purge-test-data failed:", (err as Error).message);
    process.exitCode = 1;
  })
  .finally(() => void pool().end());
