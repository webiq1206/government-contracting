/**
 * Remove test-fixture organizations that leaked into a real database.
 *
 *   npm run purge-test-orgs              # DRY RUN: lists what it WOULD remove
 *   npm run purge-test-orgs -- --delete  # actually removes them
 *
 * Integration tests create throwaway organizations ("attack-A-<uuid>",
 * "maint-a-<uuid>", "Applied Co <hex>", ...) and delete them in afterAll. When
 * a run is interrupted, or when the suite is pointed at a live database, those
 * afterAll deletes do not complete and the fixtures are left behind, marked
 * active, where the per-org agents then loop over them. This finds and removes
 * exactly those, and nothing else.
 *
 * SAFETY, layered — a wrong delete here is unrecoverable, so the bar is high:
 *
 *   1. Dry run by default. It only deletes with an explicit --delete.
 *   2. The founding organization is protected by id and can never match.
 *   3. A candidate must BOTH match a known test-fixture name pattern AND end
 *      in a generated tag (a full UUID, or a whitespace-separated 8+ hex tag).
 *      No real company a customer types ends in "…51f226c0-33ad-4d28-…" or
 *      " b0c2b405", so this cannot false-positive on a real org name.
 *   4. Any organization carrying a Stripe customer or subscription id is
 *      treated as real and skipped with a warning, whatever its name.
 *   5. A blast-radius cap: it refuses to delete more than MAX_DELETE orgs in
 *      one run unless --force is given, so a matcher bug cannot empty the
 *      table.
 *   6. Each organization is deleted in its own transaction, children first;
 *      any failure rolls that organization back whole and reports why, leaving
 *      it exactly as it was.
 *
 * It changes nothing in a dry run.
 */
import "../lib/env";
import { query, transaction, closePool } from "../lib/db";
import { LEGACY_ORG_ID } from "../lib/tenant-context";
import { looksLikeTestOrg } from "../lib/domain/test-org-match";

const DELETE = process.argv.includes("--delete");
const FORCE = process.argv.includes("--force");
const MAX_DELETE = 50;

interface OrgRow {
  id: string;
  name: string;
  subscription_status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}

async function footprint(orgId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const t of ["opportunities", "subcontractors", "communications", "bids", "contracts", "organization_members"]) {
    const r = await query<{ n: number }>(`select count(*)::int n from ${t} where org_id=$1`, [orgId]).catch(() => [{ n: -1 }]);
    counts[t] = r[0]?.n ?? -1;
  }
  return counts;
}

/** Every table with an org_id column, so deletion covers the whole schema. */
async function orgScopedTables(): Promise<string[]> {
  const rows = await query<{ table_name: string }>(
    `select table_name from information_schema.columns
      where column_name = 'org_id' and table_schema = 'public'
        and table_name <> 'organizations'
      order by table_name`
  );
  return rows.map((r) => r.table_name);
}

/**
 * Delete one org and everything under it, atomically. Business roots go first
 * so their ON DELETE CASCADE children clear; then a multi-pass sweep over
 * every remaining org-scoped table handles inter-table references without
 * needing a hand-maintained order. Any failure rolls the whole org back.
 */
async function deleteOrg(orgId: string, tables: string[]): Promise<void> {
  await transaction(async (client) => {
    for (const root of ["opportunities", "subcontractors", "contracts"]) {
      await client.query(`delete from ${root} where org_id=$1`, [orgId]);
    }
    let remaining = tables.filter(
      (t) => !["opportunities", "subcontractors", "contracts"].includes(t)
    );
    for (let pass = 0; pass < 6 && remaining.length > 0; pass++) {
      const stuck: string[] = [];
      for (const t of remaining) {
        try {
          await client.query(`savepoint s`);
          await client.query(`delete from ${t} where org_id=$1`, [orgId]);
          await client.query(`release savepoint s`);
        } catch {
          await client.query(`rollback to savepoint s`);
          stuck.push(t); // referenced by a table not cleared yet; retry next pass
        }
      }
      if (stuck.length === remaining.length) {
        throw new Error(`could not clear: ${stuck.join(", ")}`);
      }
      remaining = stuck;
    }
    await client.query(`delete from organizations where id=$1`, [orgId]);
  });
}

async function main() {
  const all = await query<OrgRow>(
    `select id, name, subscription_status, stripe_customer_id, stripe_subscription_id
       from organizations order by created_at`
  );

  const candidates: OrgRow[] = [];
  const skippedReal: OrgRow[] = [];
  for (const o of all) {
    if (o.id === LEGACY_ORG_ID) continue; // the founding org, never a candidate
    if (!looksLikeTestOrg(o.name)) continue;
    if (o.stripe_customer_id || o.stripe_subscription_id) {
      skippedReal.push(o); // a real customer, whatever the name looks like
      continue;
    }
    candidates.push(o);
  }

  console.log(`\nScanned ${all.length} organization(s). ${candidates.length} match the test-fixture pattern.\n`);
  if (skippedReal.length) {
    console.log("Skipped (name matched but has Stripe billing — treated as REAL):");
    for (const o of skippedReal) console.log(`  • ${o.name}`);
    console.log("");
  }
  if (candidates.length === 0) {
    console.log("Nothing to remove. The database is clean.");
    return;
  }

  const tables = await orgScopedTables();
  for (const o of candidates) {
    const fp = await footprint(o.id);
    const summary = Object.entries(fp).filter(([, n]) => n > 0).map(([t, n]) => `${t}:${n}`).join(" ") || "empty";
    console.log(`  ${DELETE ? "DELETE" : "would remove"}  ${o.name}  [${o.subscription_status}]  (${summary})`);
  }

  if (!DELETE) {
    console.log(`\nDRY RUN — nothing was changed. Re-run with --delete to remove the ${candidates.length} organization(s) above.`);
    return;
  }

  if (candidates.length > MAX_DELETE && !FORCE) {
    console.log(`\nRefusing to delete ${candidates.length} organizations in one run (cap is ${MAX_DELETE}). If this is genuinely correct, re-run with --force.`);
    process.exitCode = 1;
    return;
  }

  console.log("");
  let ok = 0;
  for (const o of candidates) {
    try {
      await deleteOrg(o.id, tables);
      console.log(`  ✓ removed ${o.name}`);
      ok++;
    } catch (err) {
      console.log(`  ✗ kept ${o.name} — ${(err as Error).message} (rolled back, untouched)`);
    }
  }
  console.log(`\nRemoved ${ok} of ${candidates.length} test organization(s).`);
}

main()
  .catch((err) => {
    console.error("\npurge-test-orgs failed:", err instanceof Error ? err.message : err);
    process.exitCode = 2;
  })
  .finally(() => closePool());
