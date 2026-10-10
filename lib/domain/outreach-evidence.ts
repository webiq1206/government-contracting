import { automaticMessageSql } from "./message-state";

export const OUTREACH_OUTCOMES = {
  all: "All outcomes", accepted: "Provider acceptance recorded", historical: "Historical send label", queued: "Queued",
  uncertain: "Outcome uncertain", held: "Held", draft: "Draft",
  failed: "Send refused", bounced: "Bounced", delayed: "Delivery delayed",
  reply: "Received replies to review", automatic: "Automatic / absence notices",
  unknown: "Historical evidence missing",
} as const;
export type OutreachOutcome = Exclude<keyof typeof OUTREACH_OUTCOMES, "all">;

/** Stored evidence, not a guess from a contact's current address or a tracking pixel. */
export function outreachOutcomeSql(alias: string, automaticPatternParameter: string): string {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error("Trusted SQL alias required.");
  const a = alias;
  return `case
    when ${a}.direction='inbound' then case when ${automaticMessageSql(a, automaticPatternParameter)} then 'automatic' else 'reply' end
    when ${a}.delivery_state='draft' then 'draft'
    when ${a}.delivery_state='held' then 'held'
    when ${a}.delivery_state='queued' then 'queued'
    when ${a}.delivery_state in ('attempting','unknown') then 'uncertain'
    when ${a}.delivery_state='failed' then 'failed'
    when ${a}.delivery_state='bounced' then 'bounced'
    when ${a}.delivery_state='deferred' then 'delayed'
    when nullif(${a}.provider,'') is not null and nullif(${a}.gmail_message_id,'') is not null
      and ${a}.provider_accepted_at is not null
      and ${a}.delivery_state in ('sent','delivered') then 'accepted'
    when ${a}.delivery_state in ('sent','delivered') then 'historical'
    else 'unknown' end`;
}

export function outreachNextAction(input: { outcome: OutreachOutcome; closed: boolean; quoteCount: number; replyReview: boolean }): string {
  if (input.closed) return "This solicitation is closed or stopped. Keep the history; do not resume outreach.";
  if (input.outcome === "uncertain") return "Reconcile the existing provider message before any resend. Automatic replay is blocked.";
  if (input.outcome === "queued") return "Check the recorded job and current safeguards. A queued request is not a send.";
  if (input.outcome === "bounced") return "Review the rejection and suppression before considering another contact.";
  if (input.outcome === "failed") return "Review the recorded refusal and current connection. Do not repeatedly retry unchanged credentials.";
  if (input.outcome === "held") return "Review the recorded hold and the solicitation's current requirements. Preserve opt-outs and stopped work.";
  if (input.outcome === "draft") return "Review the saved draft and its evidence. No provider attempt is established.";
  if (input.outcome === "automatic") return "Read the absence or automatic notice. It is not a substantive answer or quote.";
  if (input.replyReview) return "Review the saved reply's attribution and extracted fields before applying it.";
  if (input.quoteCount > 0) return "Review the related quote's scope, validity and source before using it in pricing.";
  if (input.outcome === "reply") return "Read their response and confirm the next step. A reply alone is not a usable quote.";
  if (input.outcome === "delayed") return "Inspect the recorded delay. Do not duplicate a message the provider may still deliver.";
  if (input.outcome === "accepted") return "Check replies and unmatched mail before a follow-up. Inbox placement remains unknown.";
  if (input.outcome === "historical") return "The old send label lacks a complete acceptance receipt. Check the original provider record and unmatched mail before deciding whether to follow up.";
  return "Review the original conversation or provider record; missing historical evidence cannot establish a send.";
}
