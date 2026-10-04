import { query, queryOne } from "./db";

export const SUB_SEARCH_INTENT_KEY = "subSearchIntentId";
export function subSearchJob(id: string, opportunityId: string) {
  return { agent: "sub-finder", payload: { opportunityId },
    opts: { subSearchIntentId: id, singletonKey: `resub:${id}`, singletonSeconds: 86400 } };
}

/** Queue admission claims only after all pre-send holds have passed. */
export async function claimSubSearchIntent(id: string, orgId: string, opportunityId: string, version: number) {
  return queryOne<{id:string}>(`update sub_search_intents set state='dispatching'
    where id=$1 and org_id=$2 and opportunity_id=$3 and pursuit_version=$4 and state='requested' returning id`,
    [id,orgId,opportunityId,version]);
}

export async function markSubSearchQueued(id: string, orgId: string, queueId: string) {
  await query(`update sub_search_intents set state='queued',queue_id=$3
    where id=$1 and org_id=$2 and state='dispatching'`,[id,orgId,queueId]);
}

/** A returned null is a confirmed non-admission; thrown/unknown handoffs never release. */
export async function releaseUnqueuedSubSearch(id: string, orgId: string) {
  await query(`update sub_search_intents set state='requested'
    where id=$1 and org_id=$2 and state='dispatching'`,[id,orgId]);
}

export async function completeSubSearchIntent(id: string, orgId: string, opportunityId: string, version: number) {
  await query(`update sub_search_intents set state='completed',completed_at=now()
    where id=$1 and org_id=$2 and opportunity_id=$3 and pursuit_version=$4
      and state in ('dispatching','queued')`,[id,orgId,opportunityId,version]);
}

/** Requested intents survive a caller crash or pre-admission hold. No uncertain dispatch expires. */
export async function recoverRequestedSubSearches(orgId: string) {
  const rows = await query<{id:string;opportunity_id:string}>(`select i.id,i.opportunity_id
    from sub_search_intents i join opportunities o on o.id=i.opportunity_id
    where i.org_id=$1 and o.org_id=$1 and i.state='requested'
      and i.pursuit_version=o.pursuit_version and o.status='open' and o.pursuit_state='active'
      and o.stage not in ('dismissed','submitted','won','lost') limit 50`,[orgId]);
  const { enqueue } = await import("./queue");
  for (const row of rows) {
    const job = subSearchJob(row.id,row.opportunity_id);
    await enqueue(job.agent,job.payload,{...job.opts,orgId});
  }
}
