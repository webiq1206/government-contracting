import { query, queryOne } from "./db";
import { fitContext, FitReviewSchema, reviewedFit, type FitContextInput } from "./domain/subcontractor-fit";
import { isClosedOutreach } from "./domain/decline-closeout";

/** A review records evidence only. It never reopens a declined request or queues work. */
export async function saveFitReview(orgId: string, opportunityId: string, pairingId: string,
  actorId: string, input: unknown, expectedContextKey: unknown) {
  const parsed = FitReviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, status: 400, error: "Provide a source and statement for both service coverage and trade capability, and confirm that you reviewed them." };
  const row = await queryOne<FitContextInput & { subcontractor_id: string; trade: string | null;
    removed_at: string | null; outreach_state: string | null; updated_at: string }>(
    `select o.id,o.location_text,o.location_state,o.solicitation_analysis,o.description,o.updated_at::text as updated_at,
            os.subcontractor_id,os.trade,os.removed_at,os.outreach_state
       from opportunity_subs os join opportunities o on o.id=os.opportunity_id
       join subcontractors s on s.id=os.subcontractor_id and s.org_id=o.org_id
      where o.org_id=$1 and o.id=$2 and os.id=$3`, [orgId,opportunityId,pairingId]);
  if (!row) return { ok: false as const, status: 404, error: "No such subcontractor on this bid." };
  if (row.removed_at || isClosedOutreach(row.outreach_state)) {
    return { ok: false as const, status: 409, error: "This request is closed or removed. A fit review cannot reopen it." };
  }
  const key = fitContext(row,row.subcontractor_id,row.trade);
  if (!key) return { ok: false as const, status: 409, error: "Confirm the trade-specific scope and project location first." };
  if (key !== expectedContextKey) return {ok:false as const,status:409,error:"The project scope or location changed. Refresh and review the current request before saving."};
  const evidence = reviewedFit(parsed.data,key,actorId);
  const saved = await query<{ id: string }>(
    `update opportunity_subs os
        set verification_json=coalesce(os.verification_json,'{}'::jsonb)
            || jsonb_build_object('outreach_fit',$4::jsonb)
       from opportunities o, subcontractors s
      where os.id=$3 and os.opportunity_id=$2 and o.id=os.opportunity_id and o.org_id=$1
        and s.id=os.subcontractor_id and s.org_id=$1 and os.removed_at is null
        and coalesce(os.outreach_state,'') not in ('declined','not_a_fit','unavailable')
        and o.updated_at=$5::timestamptz
      returning os.id`, [orgId,opportunityId,pairingId,JSON.stringify(evidence),row.updated_at]);
  if (saved.length !== 1) return { ok: false as const, status: 409, error: "The request changed during review. Refresh and review its current scope." };
  return { ok: true as const };
}
