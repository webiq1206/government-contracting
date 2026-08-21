/**
 * Delete an organization and every row under it, for integration-test cleanup.
 *
 * Test afterAll blocks used to hand-list the child tables to delete, in order.
 * That list goes stale the moment a new org-scoped table is added, and a
 * missed table makes the final `delete from organizations` throw on a NO
 * ACTION foreign key — which aborts the cleanup and LEAVES THE ORG BEHIND.
 * Run against a shared database, that is exactly how test fixtures leaked into
 * production. This clears every table with an org_id column instead, so the
 * cleanup cannot fall behind the schema.
 *
 * Autocommit + multi-pass: each delete is its own statement, and a table that
 * is still referenced by another not-yet-cleared table just fails and is
 * retried on the next pass. Best-effort by design — a test tearing down should
 * never itself throw.
 */
import { query } from "../../lib/db";

let cachedTables: string[] | null = null;

async function orgScopedTables(): Promise<string[]> {
  if (cachedTables) return cachedTables;
  const rows = await query<{ table_name: string }>(
    `select table_name from information_schema.columns
      where column_name = 'org_id' and table_schema = 'public'
        and table_name <> 'organizations'`
  ).catch(() => []);
  cachedTables = rows.map((r) => r.table_name);
  return cachedTables;
}

export async function purgeOrg(orgId: string): Promise<void> {
  if (!orgId) return;
  const tables = await orgScopedTables();
  // Business roots first so their ON DELETE CASCADE children clear in one go.
  for (const root of ["opportunities", "subcontractors", "contracts"]) {
    await query(`delete from ${root} where org_id=$1`, [orgId]).catch(() => {});
  }
  let remaining = tables.filter(
    (t) => !["opportunities", "subcontractors", "contracts"].includes(t)
  );
  for (let pass = 0; pass < 6 && remaining.length > 0; pass++) {
    const stuck: string[] = [];
    for (const t of remaining) {
      try {
        await query(`delete from ${t} where org_id=$1`, [orgId]);
      } catch {
        stuck.push(t);
      }
    }
    if (stuck.length === remaining.length) break; // no progress; give up quietly
    remaining = stuck;
  }
  await query(`delete from organizations where id=$1`, [orgId]).catch(() => {});
}
