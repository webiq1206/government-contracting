import { queryOne } from "./db";
import { isSuppressed } from "./domain/email-suppression";
import { isClosedOutreach } from "./domain/decline-closeout";
const mailbox = (value:string)=>(value.match(/<([^>]+)>/)?.[1] ?? value).trim().toLowerCase();
import type { OutreachSendParams } from "./integrations/email-transport";

/** Read again during execution and immediately before dispatch. Never infer eligibility on failure. */
export async function replySendBlock(params: OutreachSendParams, orgId: string): Promise<string | null> {
  if (await isSuppressed(orgId, params.to)) return "Email to this address is held. Review its saved contact or delivery reason.";
  const uncertain = await queryOne<{id:string}>(`select id from communications
    where org_id=$1 and direction='outbound' and lower(recipient_email)=$2
      and id is distinct from $3::uuid
      and (delivery_state in ('attempting','unknown')
        or (delivery_state='held' and meta->>'reconciled'='gmail_not_found')) limit 1`,
    [orgId,mailbox(params.to),params.sendIntentId ?? null]);
  if (uncertain) return "A previous send to this address is uncertain. Verify its receipt before sending again.";
  if (!params.opportunityId || !params.subcontractorId || params.postAwardCompliance) return null;
  const pair = await queryOne<{outreach_state:string}>(`select os.outreach_state from opportunity_subs os
    join opportunities o on o.id=os.opportunity_id
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
  return isClosedOutreach(pair.outreach_state) ? "This request is closed out. No further outreach is permitted for it." : null;
}
