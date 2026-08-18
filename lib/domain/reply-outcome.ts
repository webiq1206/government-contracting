/**
 * What an understood reply is allowed to change.
 *
 * The rule this file exists to enforce: a subcontractor's answer applies to ONE
 * solicitation. Being booked this month, or being wrong for this scope, says
 * nothing about the next job, so nothing here ever writes a global state onto
 * the subcontractor record. Outcomes land on opportunity_subs (scoped to the
 * opportunity, and to the trade when known) and on a history row.
 */
import { query } from "../db";
import type { ExtractedReply, ReplyIntent } from "../ai/reply-extract";

/**
 * Below this, the platform records what it saw and asks a human. Set where a
 * wrong automatic decision (a bad price on a bid, a sub written off) costs
 * more than the small delay of a person glancing at it.
 */
export const MIN_ACT_CONFIDENCE = 0.6;

/** How a reply lands on this one solicitation. */
export type ReplyOutcome =
  | "quoted"
  | "interested"
  | "declined"
  | "unavailable"
  | "not_a_fit"
  | "needs_info"
  | "none";

/** opportunity_subs.outreach_state written for each outcome. */
const OUTREACH_STATE: Partial<Record<ReplyOutcome, string>> = {
  quoted: "quoted",
  interested: "responded",
  declined: "declined",
  // Distinct from declined on purpose: this sub still wants this KIND of work.
  unavailable: "unavailable",
  not_a_fit: "not_a_fit",
  needs_info: "responded",
};

/** Human-readable label used in history and notifications. */
export const OUTCOME_LABEL: Record<ReplyOutcome, string> = {
  quoted: "Quoted",
  interested: "Interested",
  declined: "Declined",
  unavailable: "Unavailable for This Solicitation",
  not_a_fit: "Not a Fit for This Scope",
  needs_info: "Asked a question",
  none: "No change",
};

/** Map the model's intent onto the outcome the workflow acts on. */
export function outcomeForIntent(intent: ReplyIntent, isQuote: boolean): ReplyOutcome {
  if (isQuote) return "quoted";
  switch (intent) {
    case "quote":
      // Claimed a quote but no usable amount survived validation. Treat as
      // interested, never as quoted, so no empty quote enters the bid.
      return "interested";
    case "interested":
      return "interested";
    case "decline":
      return "declined";
    case "unavailable":
      return "unavailable";
    case "cant_fulfill":
      return "not_a_fit";
    case "question":
      return "needs_info";
    default:
      return "none";
  }
}

export interface ReplyDecision {
  outcome: ReplyOutcome;
  /** False when the platform must not change records on its own. */
  act: boolean;
  needsReview: boolean;
  reviewReason: string | null;
}

/**
 * Decide whether to act on a reply or hand it to a person.
 *
 * Three things stop automation, and each is a case where acting wrongly is
 * worse than waiting: the reading was uncertain, the reply contradicts itself,
 * or the extraction never came from real understanding in the first place.
 */
export function decideReply(
  extracted: ExtractedReply,
  opts: {
    /**
     * Attachments that looked like a quote but could not be read (a scan, an
     * unsupported format). Their contents are unknown, not absent.
     */
    unreadableAttachments?: string[];
  } = {}
): ReplyDecision {
  const outcome = outcomeForIntent(extracted.intent, extracted.isQuote);
  const unread = opts.unreadableAttachments ?? [];

  if (extracted.method !== "ai") {
    return {
      outcome,
      act: false,
      needsReview: true,
      reviewReason:
        "Could not be read by the assistant, so it was only pattern-matched. Please confirm what they meant.",
    };
  }
  if (extracted.conflicts.length > 0) {
    return {
      outcome,
      act: false,
      needsReview: true,
      reviewReason: `Their reply contradicts itself: ${extracted.conflicts.join("; ")}`,
    };
  }
  // A document we could not open is unknown content, not missing content.
  // Treating "no price in the body" as "they gave no price" would be wrong
  // precisely when the sub did the normal thing and attached their quote.
  if (unread.length > 0 && extracted.quoteAmount == null) {
    return {
      outcome,
      act: false,
      needsReview: true,
      reviewReason: `They attached ${unread.join(", ")}, which could not be read. Open the email and check whether their price is in there.`,
    };
  }
  if (extracted.confidence < MIN_ACT_CONFIDENCE) {
    return {
      outcome,
      act: false,
      needsReview: true,
      reviewReason:
        "The reply was unclear, so nothing was changed automatically. Please read it and decide.",
    };
  }
  return { outcome, act: true, needsReview: false, reviewReason: null };
}

/**
 * Bid fields that must be present before a solicitation moves forward on the
 * strength of this reply. Returned so the caller can hold the workflow and ask
 * the sub for what is missing.
 */
export function blockingGaps(extracted: ExtractedReply, outcome: ReplyOutcome): string[] {
  if (outcome !== "quoted") return [];
  const gaps: string[] = [];
  if (extracted.quoteAmount == null) gaps.push("price");
  if (!extracted.scopeSummary) gaps.push("scope");
  // Only chase what the model itself flagged, plus the two above; inventing
  // requirements would turn every quote into a clarification loop.
  for (const f of extracted.missingFields) {
    if (!gaps.includes(f)) gaps.push(f);
  }
  return gaps;
}

/** Apply the outcome to this one solicitation. Never touches other work. */
export async function applyOutcomeToSolicitation(input: {
  opportunityId: string;
  subcontractorId: string;
  trade?: string | null;
  outcome: ReplyOutcome;
}): Promise<void> {
  const state = OUTREACH_STATE[input.outcome];
  if (!state) return;
  // A null trade used to fall open and stamp every trade line for the pair.
  // Resolve it first: when the pair has exactly one trade, that is the trade
  // this reply is about. A genuinely multi-trade pair with no named trade
  // still applies to all its lines, deliberately: "we can't take this on"
  // and "we're in" are answers about the job, and a reply that priced ONE of
  // several trades reaches here with the trade named from the comm's meta.
  let trade = input.trade ?? null;
  if (trade == null) {
    const rows = await query<{ trade: string | null }>(
      `select distinct trade from opportunity_subs
        where opportunity_id = $1 and subcontractor_id = $2`,
      [input.opportunityId, input.subcontractorId]
    ).catch(() => []);
    if (rows.length === 1) trade = rows[0].trade;
  }
  await query(
    `update opportunity_subs
        set outreach_state = $4, responded_at = now()
      where opportunity_id = $1 and subcontractor_id = $2
        and ($3::text is null or coalesce(trade, '') = coalesce($3, ''))`,
    [input.opportunityId, input.subcontractorId, trade, state]
  );
}

/**
 * Write the reply into the subcontractor's history.
 *
 * Recorded whether or not the platform acted, so a human reviewing a
 * low-confidence read sees exactly what arrived and when. Deduped on the Gmail
 * message id so re-polling the same window cannot double-write.
 */
export async function recordReplyEvent(input: {
  orgId: string | null;
  subcontractorId: string;
  opportunityId: string | null;
  trade?: string | null;
  extracted: ExtractedReply;
  originalMessage: string;
  gmailMessageId?: string | null;
  gmailThreadId?: string | null;
  needsReview: boolean;
  reviewReason: string | null;
}): Promise<void> {
  const reason =
    input.extracted.capabilityNotes ||
    input.extracted.notes ||
    input.extracted.scopeSummary ||
    null;
  await query(
    `insert into subcontractor_reply_events
       (org_id, subcontractor_id, opportunity_id, trade, intent, reason,
        original_message, gmail_message_id, gmail_thread_id, extracted,
        confidence, needs_review, review_reason)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13)
     on conflict (gmail_message_id) where gmail_message_id is not null
     do nothing`,
    [
      input.orgId,
      input.subcontractorId,
      input.opportunityId,
      input.trade ?? null,
      input.extracted.intent,
      reason,
      // Bounded: history is for a human to read, not a full mail archive.
      input.originalMessage.slice(0, 20000),
      input.gmailMessageId ?? null,
      input.gmailThreadId ?? null,
      JSON.stringify(input.extracted),
      input.extracted.confidence,
      input.needsReview,
      input.reviewReason,
    ]
  );
}
