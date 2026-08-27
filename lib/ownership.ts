import { query, queryOne } from "@/lib/db";
import { currentOrg } from "@/lib/data";
import { ownerName, type Owner } from "@/lib/domain/ownership";

/**
 * Reading and writing who a record is on.
 *
 * Every function here scopes by the caller's organization, and the assignment
 * itself is validated in the database: a trigger refuses an assignee who is
 * not a member of the record's organization, because a check that lives only
 * in a form is one an API call walks past, and the specific thing it would
 * walk past here is naming a person in another company as the owner of this
 * one's bid.
 */

/** Which records can carry an owner. Named, so a caller cannot pass a table. */
export const OWNABLE = {
  opportunity: "opportunities",
  compliance: "compliance_items",
  contract: "contracts",
  subcontractor: "subcontractors",
} as const;

export type OwnableKind = keyof typeof OWNABLE;

export function isOwnableKind(v: string): v is OwnableKind {
  return Object.prototype.hasOwnProperty.call(OWNABLE, v);
}

/**
 * The people this record could be assigned to.
 *
 * Members of the caller's organization, and nobody else. This list is what the
 * picker renders, so anything wrong with it becomes a name on a screen.
 */
export async function assignableMembers(): Promise<Owner[]> {
  const orgId = await currentOrg();
  const rows = await query<{ id: string; name: string | null; email: string | null }>(
    `select u.id, u.name, u.email
       from organization_members m
       join users u on u.id = m.user_id
      where m.org_id = $1
      order by coalesce(nullif(btrim(u.name), ''), u.email) asc`,
    [orgId]
  );
  return rows.map((r) => ({ id: r.id, name: ownerName(r) }));
}

/**
 * Set or clear the owner of one record.
 *
 * Returns false when the record is not this organization's, rather than
 * throwing: the caller is an API route that has to answer 404, and a thrown
 * error there would be a 500 telling an attacker the row exists.
 */
export async function assignRecord(
  kind: OwnableKind,
  recordId: string,
  assigneeId: string | null,
  actorId: string | null
): Promise<boolean> {
  const orgId = await currentOrg();
  const table = OWNABLE[kind];
  /*
   * The org predicate is in the WHERE clause rather than checked first.
   * A read-then-write leaves a window, and more importantly it puts the guard
   * somewhere a later edit can remove without any test noticing.
   */
  const rows = await query<{ id: string }>(
    `update ${table}
        set assigned_to = $3,
            assigned_by = case when $3::uuid is null then null else $4::uuid end,
            assigned_at = case when $3::uuid is null then null else now() end
      where id = $2 and org_id = $1
      returning id`,
    [orgId, recordId, assigneeId, actorId]
  );
  return rows.length > 0;
}

/** The owner of one record, or null when nobody has said. */
export async function ownerOf(kind: OwnableKind, recordId: string): Promise<Owner | null> {
  const orgId = await currentOrg();
  const table = OWNABLE[kind];
  const row = await queryOne<{ id: string; name: string | null; email: string | null }>(
    `select u.id, u.name, u.email
       from ${table} r
       join users u on u.id = r.assigned_to
      where r.id = $2 and r.org_id = $1`,
    [orgId, recordId]
  );
  return row ? { id: row.id, name: ownerName(row) } : null;
}

/**
 * Owners for many records at once, keyed by record id.
 *
 * One query rather than one per row. The queue draws up to fifty rows and the
 * pipeline table two hundred, and a per-row lookup there is the shape that
 * turns a fast page into a slow one without anybody changing the page.
 */
export async function ownersFor(
  kind: OwnableKind,
  recordIds: string[]
): Promise<Map<string, Owner>> {
  const out = new Map<string, Owner>();
  if (recordIds.length === 0) return out;
  const orgId = await currentOrg();
  const table = OWNABLE[kind];
  const rows = await query<{
    record_id: string;
    id: string;
    name: string | null;
    email: string | null;
  }>(
    `select r.id as record_id, u.id, u.name, u.email
       from ${table} r
       join users u on u.id = r.assigned_to
      where r.org_id = $1 and r.id = any($2::uuid[])`,
    [orgId, recordIds]
  );
  for (const r of rows) out.set(r.record_id, { id: r.id, name: ownerName(r) });
  return out;
}
