import { queryOne } from "./db";
type RefusalInput = {
  orgId: string; actorId: string; requestKey: string; subcontractorId: string;
  opportunityId: string; trade: string;
};

export async function projectMessageWasRefused(input: RefusalInput) {
  return !!await queryOne<{ id: string }>(`select id from communications
    where org_id=$1 and request_key=$2 and subcontractor_id=$3 and opportunity_id=$4
      and meta->>'actor_id'=$5 and meta->>'trade'=$6
      and meta->>'preflight_refused'='true' and delivery_state='held'`,
    [input.orgId, input.requestKey, input.subcontractorId, input.opportunityId, input.actorId, input.trade]);
}

/** Fence a preflight refusal before permitting a replacement. An absent SELECT
 * alone cannot prove that a delayed copy of the original request will not send. */
export async function refuseProjectMessage(input: RefusalInput) {
  const { orgId, actorId, requestKey, subcontractorId, opportunityId, trade } = input;
  const row = await queryOne<{ id: string }>(`insert into communications
    (org_id,subcontractor_id,opportunity_id,channel,direction,subject,body,
     delivery_state,request_key,request_fingerprint,meta)
    select $1,s.id,o.id,'email','outbound','Message held before sending','',
      'held',$4::uuid,'preflight-refused:' || ($4::uuid)::text,$5::jsonb
    from subcontractors s join opportunities o on o.id=$3 and o.org_id=$1
    where s.id=$2 and s.org_id=$1
    on conflict (org_id,request_key) where request_key is not null do nothing
    returning id`, [orgId, subcontractorId, opportunityId, requestKey,
    JSON.stringify({ kind: "manual", actor_id: actorId, trade, preflight_refused: true })]);
  if (row) return true;
  const existing = await queryOne<{ delivery_state: string }>(`select delivery_state from communications
    where org_id=$1 and request_key=$2 and subcontractor_id=$3 and opportunity_id=$4
      and meta->>'actor_id'=$5 and meta->>'trade'=$6`,
    [orgId, requestKey, subcontractorId, opportunityId, actorId, trade]);
  return !!existing && ["held", "failed"].includes(existing.delivery_state);
}
