import { queryOne } from "./db";

/** Existing invitations/assignments only. A compose request cannot create or revive a relationship. */
export async function projectMessageTarget(orgId: string, subId: string, projectId: string, trade: string) {
  return queryOne<{
    id: string; company_name: string; email: string | null; email_verified: boolean;
    title: string; trade: string | null; pursuit_version: number;
  }>(`select s.id,s.company_name,s.email,s.email_verified,o.title,os.trade,o.pursuit_version
    from opportunity_subs os
    join subcontractors s on s.id=os.subcontractor_id and s.org_id=$1
    join opportunities o on o.id=os.opportunity_id and o.org_id=$1
    where s.id=$2 and s.archived_at is null and o.id=$3 and coalesce(os.trade,'')=$4 and os.removed_at is null
      and coalesce(o.pursuit_state,'active')='active' and o.stage not in ('won','lost','archived')
      and o.status='open' limit 1`, [orgId, subId, projectId, trade]);
}
