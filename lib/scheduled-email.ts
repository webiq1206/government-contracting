import { createHash, randomUUID } from "node:crypto";
import { queryOne } from "./db";
import type { OutreachSendParams, OutreachSendResult } from "./integrations/email-transport";

export interface ScheduledEmail {
  /** Stable business intent, never a job id, content hash, or current time. */
  key: string;
  meta: Record<string, unknown>;
  followUpAt?: string | null;
}

export function scheduledRequestKey(key: string): string {
  const hex = createHash("sha256").update(`scheduled-email:v1:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

type Claim = { id: string; delivery_state: string; gmail_message_id: string | null;
  gmail_thread_id: string | null; rfc822_message_id: string | null };
const review = "This scheduled message already has an unfinished or uncertain send. Review its communication and Gmail Sent; it will not be sent again automatically.";

/** One durable communication per business intent. No expiring provider lease. */
export async function sendScheduledEmail(params: OutreachSendParams,
  send: (params: OutreachSendParams) => Promise<OutreachSendResult>): Promise<OutreachSendResult> {
  const schedule = params.scheduled!;
  if (!params.orgId || !params.subcontractorId)
    return { provider: null, error: "Scheduled mail requires its owning account and contact.", retryable: false };
  const key = scheduledRequestKey(schedule.key);
  const owner = randomUUID();
  let claim: Claim | null = null;
  let attempted = false;
  try {
    if (schedule.meta.kind === "compliance-chase") {
      const prior = await queryOne<{ id: string }>(`select id from communications
        where org_id=$1 and subcontractor_id=$2 and meta->>'kind'='compliance-chase'
          and request_key is distinct from $3::uuid
          and (delivery_state in ('queued','attempting','unknown')
            or (delivery_state in ('sent','delivered','bounced','deferred')
              and coalesce(provider_accepted_at,created_at)>now()-interval '5 days')) limit 1`,
        [params.orgId,params.subcontractorId,key]);
      if (prior) return {provider:null,communicationId:prior.id,error:"A recent or unresolved paperwork request already exists. Review that communication before sending another.",retryable:false,outcome:"unknown"};
    }
    claim = await queryOne<Claim>(`insert into communications
      (org_id,subcontractor_id,opportunity_id,channel,direction,subject,body,
       recipient_email,gmail_thread_id,tracking_id,delivery_state,request_key,request_fingerprint,meta)
      values ($1,$2,$3,'email','outbound',$4,$5,$6,$7,$8,'queued',$9,$10,$11::jsonb)
      on conflict (org_id,request_key) where request_key is not null do nothing returning *`,
      [params.orgId,params.subcontractorId,params.opportunityId ?? null,params.subject,
        params.text ?? params.html,params.to,params.threadId ?? null,params.trackingId ?? null,key,owner,
        JSON.stringify({...schedule.meta, scheduled_key: schedule.key, trade: params.trade ?? null})]);
    if (!claim) {
      const existing = await queryOne<Claim>(`select * from communications where org_id=$1 and request_key=$2`, [params.orgId,key]);
      if (existing && ["sent","delivered","bounced","deferred"].includes(existing.delivery_state) && existing.gmail_message_id)
        return { provider: "gmail", outcome: "accepted", communicationId: existing.id, replayed: true,
          messageId: existing.gmail_message_id, threadId: existing.gmail_thread_id, rfc822MessageId: existing.rfc822_message_id };
      // A confirmed pre-send hold or HTTP refusal is safe to try later. CAS
      // changes the owner; a delayed settlement from an earlier owner cannot win.
      claim = await queryOne<Claim>(`update communications set delivery_state='queued', request_fingerprint=$3,
        subject=$4,body=$5,recipient_email=$6,meta=$7::jsonb,provider_attempted_at=null,
        sender_email=null,delivery_detail=null,delivery_updated_at=now(),
        tracking_id=$8,gmail_thread_id=$9
        where org_id=$1 and request_key=$2 and delivery_state in ('held','failed') returning *`,
        [params.orgId,key,owner,params.subject,params.text ?? params.html,params.to,
          JSON.stringify({...schedule.meta,scheduled_key:schedule.key,trade:params.trade ?? null}),
          params.trackingId ?? null,params.threadId ?? null]);
      if (!claim) return { provider: null, outcome: "unknown", retryable: false,
        communicationId: existing?.id, error: review };
    }
    const result = await send({...params,scheduled:undefined,beforeProviderSend:async (from) => {
      const stamped = await queryOne<{id:string}>(`update communications set delivery_state='attempting',
        sender_email=$4,provider_attempted_at=now(),delivery_updated_at=now()
        where id=$1 and org_id=$2 and request_fingerprint=$3 and delivery_state='queued' returning id`,
        [claim!.id,params.orgId,owner,from]);
      if (!stamped) throw new Error("Scheduled send claim could not be confirmed.");
      attempted = true;
      await params.beforeProviderSend?.(from);
    }});
    const accepted = !!result.messageId && !result.error && !result.disabled && !result.blocked;
    const state = accepted ? "sent" : !attempted || result.outcome === "not_attempted" ? "held"
      : result.outcome === "refused" ? "failed" : "unknown";
    const saved = await queryOne<{id:string}>(`update communications set delivery_state=$4,
      provider=$5,gmail_message_id=$6,gmail_thread_id=coalesce($7,gmail_thread_id),rfc822_message_id=$8,
      delivery_detail=$9,delivery_updated_at=now(),provider_accepted_at=case when $4='sent' then now() else null end,
      follow_up_at=case when $4='sent' then $10::timestamptz else null end,
      meta=meta || jsonb_build_object('sent',$4='sent')
      where id=$1 and org_id=$2 and request_fingerprint=$3 returning id`,
      [claim.id,params.orgId,owner,state,result.provider,result.messageId ?? null,result.threadId ?? null,
        result.rfc822MessageId ?? null,result.error ?? null,schedule.followUpAt ?? null]);
    if (!saved) throw new Error("Scheduled send receipt could not be confirmed.");
    return {...result,communicationId:claim.id,...(state === "unknown" ? {error:review,retryable:false,outcome:"unknown" as const} : {})};
  } catch {
    // A write may have committed despite a lost response. Never clear the claim.
    return {provider:null,communicationId:claim?.id,outcome:"unknown",retryable:false,
      error:"The scheduled send outcome could not be recorded. Review Gmail Sent and its communication before taking further action; no automatic replay is allowed."};
  }
}
