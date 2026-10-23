import { queryOne } from "./db";
import { isSuppressed } from "./domain/email-suppression";
import { isClosedOutreach } from "./domain/decline-closeout";
const mailbox = (value:string)=>(value.match(/<([^>]+)>/)?.[1] ?? value).trim().toLowerCase();
import type { OutreachSendParams } from "./integrations/email-transport";
import { fitContext, fitSendBlock, type FitContextInput } from "./domain/subcontractor-fit";

/** Read again during execution and immediately before dispatch. Never infer eligibility on failure. */
export async function replySendBlock(params: OutreachSendParams, orgId: string,
  options: { receiptRecoveryOnly?: boolean } = {}): Promise<string | null> {
  if (await isSuppressed(orgId, params.to)) return "Email to this address is held. Review its saved contact or delivery reason.";
  const uncertain = await queryOne<{id:string}>(`select id from communications
    where org_id=$1 and direction='outbound' and lower(recipient_email)=$2
      and id is distinct from $3::uuid
      and (delivery_state in ('attempting','unknown')
        or (delivery_state='held' and meta->>'reconciled'='gmail_not_found')) limit 1`,
    [orgId,mailbox(params.to),params.sendIntentId ?? null]);
  if (uncertain) return "A previous send to this address is uncertain. Verify its receipt before sending again.";
  if (!params.opportunityId || !params.subcontractorId || params.postAwardCompliance) return null;
  const pair = await queryOne<FitContextInput & {outreach_state:string; verification_json:unknown}>(`select os.outreach_state,os.verification_json,
      o.id,o.location_text,o.location_state,o.solicitation_analysis,o.description from opportunity_subs os
    join opportunities o on o.id=os.opportunity_id
    join subcontractors s on s.id=os.subcontractor_id and s.org_id=o.org_id
    where o.org_id=$1 and os.opportunity_id=$2 and os.subcontractor_id=$3
      and os.removed_at is null and coalesce(os.trade,'')=coalesce($4::text,'')`,
    [orgId,params.opportunityId,params.subcontractorId,params.trade ?? null]);
  if (!pair) return "The active request and trade could not be verified.";
  if (params.declineAcknowledgment) {
    const reply = await queryOne<{recipient_email:string;meta:Record<string,unknown>;gmail_thread_id:string;rfc822_message_id:string}>(
      `select recipient_email,meta,gmail_thread_id,rfc822_message_id from communications
       where org_id=$1 and direction='inbound' and gmail_message_id=$2
         and opportunity_id=$3 and subcontractor_id=$4`,
      [orgId,params.declineAcknowledgment.inboundMessageId,params.opportunityId,params.subcontractorId]);
    if (pair.outreach_state !== "declined" || !reply || reply.meta?.notice_kind !== "decline" ||
        reply.meta?.reply_sender_verified !== true || reply.meta?.reply_strong_match !== true ||
        reply.meta?.reply_action_allowed !== true || mailbox(reply.recipient_email) !== mailbox(params.to) ||
        reply.gmail_thread_id !== params.threadId || reply.rfc822_message_id !== params.inReplyTo ||
        (reply.meta?.trade ?? "") !== (params.trade ?? "")) {
      return "A clear human decline and its exact conversation could not be verified; no acknowledgment was sent.";
    }
    return null;
  }
  if (isClosedOutreach(pair.outreach_state)) return "This request is closed out. No further outreach is permitted for it.";
  // Only the agent's non-sending receipt-recovery path uses this option.
  // The transport always runs the complete check, including at dispatch.
  if(options.receiptRecoveryOnly)return null;
  // Durable intent, not a caller-provided bypass. Explicit operator replies
  // to a saved inbound message can answer questions before fit is established.
  // They still honor closure, opt-outs and uncertain-send holds above.
  const intent=params.sendIntentId ? await queryOne<{meta:Record<string,unknown>}>(
    `select meta from communications where id=$1 and org_id=$2 and opportunity_id=$3
       and subcontractor_id=$4 and direction='outbound'`,
    [params.sendIntentId,orgId,params.opportunityId,params.subcontractorId]) : null;
  const kind=intent?.meta?.kind ?? params.scheduled?.meta?.kind;
  if(kind === "outreach" && params.attachments?.length) {
    return "Initial invitations do not include solicitation attachments. Rebuild this request with the checked project-document link.";
  }
  if(kind === "manual" && intent?.meta?.actor_id && params.threadId) {
    const incoming=await queryOne<{id:string}>(`select id from communications
      where org_id=$1 and opportunity_id=$2 and subcontractor_id=$3 and direction='inbound'
        and gmail_thread_id=$4 and lower(btrim(case when position('<' in recipient_email)>0
          then split_part(split_part(recipient_email,'<',2),'>',1) else recipient_email end))=$5
        and rfc822_message_id=$6`,
      [orgId,params.opportunityId,params.subcontractorId,params.threadId,mailbox(params.to),params.inReplyTo ?? null]);
    if(incoming)return null;
  }
  const unresolved = await incomingReplyReviewBlock(orgId,params.opportunityId,params.subcontractorId,params.trade);
  if(unresolved)return unresolved;
  return fitSendBlock(pair.verification_json,fitContext(pair,params.subcontractorId,params.trade));
}

/** Also used by queued call preparation: captured does not mean understood/applied. */
export async function incomingReplyReviewBlock(orgId:string,opportunityId:string,subcontractorId:string,trade:string|null|undefined):Promise<string|null> {
  const unresolvedReply=await queryOne<{id:string}>(`select c.id from communications c
    left join subcontractor_reply_events e on e.org_id=c.org_id and e.gmail_message_id=c.gmail_message_id
    where c.org_id=$1 and c.opportunity_id=$2 and c.subcontractor_id=$3 and c.direction='inbound'
      and (coalesce(c.meta->>'trade','')='' or c.meta->>'trade'=coalesce($4::text,''))
      and ((c.meta->>'capture_version'='1' and c.meta->>'reply_processing_complete'='false')
        or (e.needs_review and e.reviewed_at is null and coalesce(c.meta->>'reply_action_allowed','false')='false'))
    limit 1`,[orgId,opportunityId,subcontractorId,trade ?? null]);
  if(unresolvedReply)return "An incoming reply still needs processing or review. Resolve its saved outcome before further outreach.";
  return null;
}
