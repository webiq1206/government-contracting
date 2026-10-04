import { createHash } from "node:crypto";
import { queryOne } from "./db";
import { sendOutreachEmail, type OutreachSendParams } from "./integrations/email-transport";

export interface ManualEmailInput {
  requestKey: string;
  actorId: string;
  params: OutreachSendParams & { orgId: string; subcontractorId: string };
}
type Claim = { id: string; request_fingerprint: string; delivery_state: string;
  gmail_thread_id: string | null; rfc822_message_id: string | null };

/** The claim never expires: an interrupted provider handoff needs reconciliation. */
export async function sendManualEmail({ requestKey, actorId, params }: ManualEmailInput) {
  const fingerprint = createHash("sha256").update(JSON.stringify({ actorId,
    sub: params.subcontractorId, opportunity: params.opportunityId ?? null,
    thread: params.threadId ?? null, subject: params.subject, text: params.text,
    to: params.to, trade: params.trade ?? null })).digest("hex");
  const claim = await queryOne<Claim>(
    `insert into communications (org_id, subcontractor_id, opportunity_id, channel,
       direction, subject, body, recipient_email, gmail_thread_id, delivery_state,
       request_key, request_fingerprint, meta)
     values ($1,$2,$3,'email','outbound',$4,$5,$6,$7,'queued',$8,$9,$10::jsonb)
     on conflict (org_id, request_key) where request_key is not null do nothing
     returning id, request_fingerprint, delivery_state, gmail_thread_id, rfc822_message_id`,
    [params.orgId, params.subcontractorId, params.opportunityId ?? null, params.subject,
      params.text ?? "", params.to, params.threadId ?? null, requestKey, fingerprint,
      JSON.stringify({ kind: "manual", actor_id: actorId, trade: params.trade ?? null,
        in_reply_to: params.inReplyTo ?? null, references: params.references ?? [] })]);
  if (!claim) {
    const existing = await queryOne<Claim>(`select id, request_fingerprint, delivery_state,
      gmail_thread_id, rfc822_message_id from communications where org_id=$1 and request_key=$2`,
      [params.orgId, requestKey]);
    if (!existing || existing.request_fingerprint !== fingerprint)
      return { ok: false as const, status: 409, error: "This send request already exists with different content. Review the conversation before composing another message." };
    if (["sent", "delivered", "bounced", "deferred"].includes(existing.delivery_state))
      return { ok: true as const, threadId: existing.gmail_thread_id, rfc822MessageId: existing.rfc822_message_id };
    return { ok: false as const, status: 409, safeToCompose: ["held", "failed"].includes(existing.delivery_state), error: "This send request is already recorded. Review its outcome and Gmail Sent before composing another message; it will not be sent twice." };
  }
  let attempted = false;
  try {
    const result = await sendOutreachEmail({ ...params,
      beforeProviderSend: async (from) => {
        await params.beforeProviderSend?.(from);
        const stamped = await queryOne<{ id: string }>(`update communications set
          delivery_state='attempting', sender_email=$3, provider_attempted_at=now(),
          delivery_updated_at=now() where id=$1 and org_id=$2 and delivery_state='queued' returning id`,
          [claim.id, params.orgId, from]);
        if (!stamped) throw new Error("The send claim could not be confirmed.");
        attempted = true;
      },
    });
    const accepted = !!result.messageId && !result.error && !result.disabled && !result.blocked;
    const state = accepted ? "sent" : result.disabled || result.blocked || result.outcome === "not_attempted" || !attempted ? "held" : result.outcome === "refused" ? "failed" : "unknown";
    const saved = await queryOne<{ id: string }>(`update communications set delivery_state=$3,
      provider=$4, gmail_message_id=$5, gmail_thread_id=coalesce($6,gmail_thread_id),
      rfc822_message_id=$7, delivery_detail=$8, delivery_updated_at=now(),
      provider_accepted_at=case when $3='sent' then now() else null end
      where id=$1 and org_id=$2 returning id`, [claim.id, params.orgId, state,
      result.provider, result.messageId ?? null, result.threadId ?? null,
      result.rfc822MessageId ?? null, result.error ?? null]);
    if (!saved) throw new Error("The send outcome could not be recorded.");
    if (!accepted) return { ok: false as const, status: result.disabled ? 503 : 502, safeToCompose: state === "held" || state === "failed",
      error: state === "unknown" ? "Delivery is uncertain. Check Gmail Sent before composing another message. This request will not be retried." : result.error ?? "The message was held before sending." };
    return { ok: true as const, threadId: result.threadId ?? params.threadId ?? null,
      rfc822MessageId: result.rfc822MessageId ?? null };
  } catch {
    // A failed write can have committed. Never reset or replay this claim.
    return { ok: false as const, status: 503,
      error: "The send outcome could not be confirmed. Check this conversation and Gmail Sent before composing another message. This request will not be retried." };
  }
}
