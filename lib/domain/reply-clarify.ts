/**
 * Automatic clarification requests.
 *
 * When a subcontractor's reply is understood but incomplete, the platform asks
 * them for the missing pieces rather than parking the solicitation until
 * somebody notices. The email is deliberately short and specific: it names
 * only what is actually missing, and it replies inside the existing thread so
 * the sub sees their own message underneath.
 *
 * Guardrails, because this sends mail on the customer's behalf:
 *   - only for a reply the platform was confident enough to act on
 *   - never for someone who declined, is unavailable, or is not a fit
 *   - at most once per subcontractor per solicitation
 */
import { query, queryOne } from "../db";
import { sendOutreachEmail } from "../integrations/email-transport";
import type { ReplyOutcome } from "./reply-outcome";

/** Plain-English label for each gap. Never jargon: a sub reads this. */
const GAP_LABEL: Record<string, string> = {
  price: "your total price for the work",
  scope: "what the price covers",
  lead_time: "how soon you could start",
  exclusions: "anything the price does not include",
  payment_terms: "your payment terms",
  bonding: "whether you can be bonded for this",
  insurance: "your insurance limits",
  licensing: "your license number for this state",
  availability: "your availability for this schedule",
};

export function describeGap(gap: string): string {
  return GAP_LABEL[gap] ?? gap.replace(/_/g, " ");
}

export interface ClarifyResult {
  sent: boolean;
  reason?: string;
}

/**
 * Ask one subcontractor for the missing bid information.
 *
 * Returns rather than throws: a clarification that fails to send must not stop
 * the reply from being recorded.
 */
export async function requestClarification(input: {
  opportunityId: string;
  subcontractorId: string;
  toEmail: string;
  companyName: string | null;
  opportunityTitle: string | null;
  trade?: string | null;
  gaps: string[];
  outcome: ReplyOutcome;
  threadId?: string | null;
  inReplyToMessageId?: string | null;
  orgId?: string | null;
}): Promise<ClarifyResult> {
  if (input.gaps.length === 0) return { sent: false, reason: "nothing missing" };
  // Someone who said no is not chased for paperwork.
  if (input.outcome !== "quoted" && input.outcome !== "interested") {
    return { sent: false, reason: "outcome does not warrant a follow-up" };
  }
  if (!input.toEmail) return { sent: false, reason: "no email address" };

  // One ask per sub per solicitation. Without this, every re-poll of the
  // sliding window would send another near-identical email.
  const already = await queryOne<{ id: string }>(
    `select id from communications
      where subcontractor_id = $1 and opportunity_id = $2
        and direction = 'outbound' and meta->>'kind' = 'clarification'
      limit 1`,
    [input.subcontractorId, input.opportunityId]
  ).catch(() => null);
  if (already) return { sent: false, reason: "already asked" };

  const job = input.opportunityTitle ?? "the project we contacted you about";
  const items = input.gaps.map(describeGap);
  const bullets = items.map((i) => `<li>${i}</li>`).join("");
  const plainList = items.map((i) => `- ${i}`).join("\n");

  const greeting = input.companyName ? `Hi ${input.companyName},` : "Hi,";
  const subject = `Quick follow-up on ${job}`;
  const html =
    `<div style="font-family:Inter,Helvetica,Arial,sans-serif;color:#242424;font-size:14px;line-height:1.6">` +
    `<p>${greeting}</p>` +
    `<p>Thanks for getting back to us on ${job}. Before we can put your numbers in, we still need:</p>` +
    `<ul>${bullets}</ul>` +
    `<p>Just reply to this email and we will take it from there.</p>` +
    `</div>`;
  const text = [
    greeting,
    "",
    `Thanks for getting back to us on ${job}. Before we can put your numbers in, we still need:`,
    "",
    plainList,
    "",
    "Just reply to this email and we will take it from there.",
  ].join("\n");

  const res = await sendOutreachEmail({
    to: input.toEmail,
    subject,
    html,
    text,
    // Same thread, so the sub sees their own message below ours.
    threadId: input.threadId ?? undefined,
    inReplyTo: input.inReplyToMessageId ?? undefined,
    orgId: input.orgId ?? undefined,
  });

  if (res.disabled || res.blocked || res.error) {
    return { sent: false, reason: res.error ?? "send unavailable" };
  }

  await query(
    `insert into communications
       (subcontractor_id, opportunity_id, channel, direction, subject, body,
        gmail_message_id, gmail_thread_id, provider, recipient_email, meta)
     values ($1,$2,'email','outbound',$3,$4,$5,$6,'gmail',$7,$8::jsonb)`,
    [
      input.subcontractorId,
      input.opportunityId,
      subject,
      text,
      res.messageId,
      res.threadId,
      input.toEmail,
      JSON.stringify({
        kind: "clarification",
        gaps: input.gaps,
        ...(input.trade ? { trade: input.trade } : {}),
      }),
    ]
  );

  return { sent: true };
}
