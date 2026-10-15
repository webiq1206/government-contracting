import { queryOne } from "./db";

/** Count only links on the requested tenant's opportunity. Never return an
 * unowned/foreign subcontractor's identity or make it available for outreach. */
export async function unavailableSubcontractorLinks(opportunityId: string, orgId: string): Promise<number> {
  const row = await queryOne<{ count: number }>(
    `select count(os.id)::int as count
       from opportunities o
       join opportunity_subs os on os.opportunity_id=o.id
       left join subcontractors s on s.id=os.subcontractor_id and s.org_id=$2
      where o.id=$1 and o.org_id=$2 and os.removed_at is null
        and s.id is null`,
    [opportunityId, orgId]
  );
  if (!row || !Number.isSafeInteger(row.count) || row.count < 0) {
    throw new Error("Subcontractor link availability could not be established.");
  }
  return row.count;
}
