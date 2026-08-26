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
  /*
   * Added because each was previously flattened into something that read as a
   * settled answer when it was not.
   */
  /** Priced or offered PART of the scope. The rest still needs covering. */
  | "partial_scope"
  /** Wants to quote, needs longer than we gave them. */
  | "needs_time"
  /** Right company, wrong person. Nothing about the company is settled. */
  | "wrong_contact"
  /** Pointed us somewhere else. */
  | "referred"
  /** Does not work in this trade at all. */
  | "does_not_perform_trade"
  /**
   * A reply arrived and nobody could say what it meant.
   *
   * Its own outcome rather than a flag on a guess. `decideReply` already
   * refused to act on an unreadable or self-contradictory reply, but it still
   * returned the model's proposed outcome, so a message nobody understood
   * could sit on a screen labelled "Declined" with a review tick beside it.
   * The label is the thing people read.
   */
  | "unclear"
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
  /*
   * Partial coverage is a RESPONSE, not a completed quote. Writing "quoted"
   * here is what let a bid be assembled around a hole: the trade line read as
   * covered while a third of the work had no price against it.
   */
  partial_scope: "responded",
  needs_time: "responded",
  // Nothing about the COMPANY is settled by writing to the wrong person, so
  // the pairing stays open for a corrected contact.
  wrong_contact: "responded",
  referred: "responded",
  does_not_perform_trade: "not_a_fit",
};

/** Human-readable label used in history and notifications. */
export const OUTCOME_LABEL: Record<ReplyOutcome, string> = {
  quoted: "Quoted",
  interested: "Interested",
  declined: "Declined",
  unavailable: "Unavailable for This Solicitation",
  not_a_fit: "Not a Fit for This Scope",
  needs_info: "Asked a question",
  partial_scope: "Quoted part of the scope",
  needs_time: "Needs more time",
  wrong_contact: "Wrong contact at this company",
  referred: "Referred us elsewhere",
  does_not_perform_trade: "Does not perform this trade",
  unclear: "Unclear, needs review",
  none: "No change",
};

/** Map the model's intent onto the outcome the workflow acts on. */
export function outcomeForIntent(
  intent: ReplyIntent,
  isQuote: boolean,
  /** False only when the reply says it is covering part of the work. */
  coversFullScope?: boolean | null
): ReplyOutcome {
  /*
   * Partial coverage beats a price.
   *
   * A subcontractor who prices two of three buildings has sent a real number,
   * and the old rule ("if there is a price, it is a quote") recorded that as
   * the trade being covered. The email reads like a complete quote, so nobody
   * caught it until the bid was short a building.
   */
  if (intent === "partial_scope" || coversFullScope === false) return "partial_scope";
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
    case "needs_time":
      return "needs_time";
    case "wrong_contact":
      return "wrong_contact";
    case "referred":
      return "referred";
    case "does_not_perform_trade":
      return "does_not_perform_trade";
    default:
      return "none";
  }
}

export interface ReplyDecision {
  outcome: ReplyOutcome;
  /**
   * What the reading suggested, when the outcome above is `unclear`.
   *
   * Kept so a reviewer starts from the model's guess rather than from
   * nothing, and null when the outcome IS the reading, so nobody has to work
   * out whether the two fields agree.
   */
  proposed: ReplyOutcome | null;
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
  const outcome = outcomeForIntent(
    extracted.intent,
    extracted.isQuote,
    extracted.coversFullScope
  );
  const unread = opts.unreadableAttachments ?? [];

  if (extracted.method !== "ai") {
    return {
      // Pattern matching produced a word, not an understanding of the reply.
      outcome: "unclear",
      proposed: outcome,
      act: false,
      needsReview: true,
      reviewReason:
        "Could not be read by the assistant, so it was only pattern-matched. Please confirm what they meant.",
    };
  }
  if (extracted.conflicts.length > 0) {
    return {
      // A reply that contradicts itself has no single meaning to record.
      outcome: "unclear",
      proposed: outcome,
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
      /*
       * Not unclear. The reply may be perfectly plain ("our price is
       * attached"); what is missing is the price, not the meaning, and
       * relabelling it would lose the one thing the reading did establish.
       */
      outcome,
      proposed: null,
      act: false,
      needsReview: true,
      reviewReason: `They attached ${unread.join(", ")}, which could not be read. Open the email and check whether their price is in there.`,
    };
  }
  if (extracted.confidence < MIN_ACT_CONFIDENCE) {
    return {
      outcome: "unclear",
      proposed: outcome,
      act: false,
      needsReview: true,
      reviewReason:
        "The reply was unclear, so nothing was changed automatically. Please read it and decide.",
    };
  }
  return { outcome, proposed: null, act: true, needsReview: false, reviewReason: null };
}

/**
 * Bid fields that must be present before a solicitation moves forward on the
 * strength of this reply. Returned so the caller can hold the workflow and ask
 * the sub for what is missing.
 */
export function blockingGaps(extracted: ExtractedReply, outcome: ReplyOutcome): string[] {
  /*
   * Partial coverage is chased as hard as a full quote, because it is a real
   * price against a scope we have to be able to describe. The one thing we
   * must know is which part is NOT covered: without it, "partial" is a label
   * on a record and nobody can act on it.
   */
  if (outcome === "partial_scope") {
    const gaps: string[] = [];
    if (!extracted.uncoveredScope) gaps.push("uncovered_scope");
    if (extracted.quoteAmount == null) gaps.push("price");
    return gaps;
  }
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

export interface OutcomeApplied {
  applied: boolean;
  /** Why nothing was written, when nothing was. */
  refused: "no_state_for_outcome" | "ambiguous_trade" | null;
  /** The trades that would have been stamped, for the review task. */
  candidateTrades: string[];
}

/**
 * Apply the outcome to this one solicitation. Never touches other work.
 *
 * Returns what it did, because one case is a refusal a caller has to act on
 * rather than ignore.
 */
export async function applyOutcomeToSolicitation(input: {
  opportunityId: string;
  subcontractorId: string;
  trade?: string | null;
  outcome: ReplyOutcome;
}): Promise<OutcomeApplied> {
  const state = OUTREACH_STATE[input.outcome];
  if (!state) return { applied: false, refused: "no_state_for_outcome", candidateTrades: [] };

  let trade = input.trade ?? null;
  let candidateTrades: string[] = [];
  if (trade == null) {
    const rows = await query<{ trade: string | null }>(
      `select distinct trade from opportunity_subs
        where opportunity_id = $1 and subcontractor_id = $2`,
      [input.opportunityId, input.subcontractorId]
    ).catch(() => []);
    candidateTrades = rows.map((r) => r.trade).filter((t): t is string => !!t);
    // Exactly one trade on the pairing means that is the trade this reply is
    // about, whether or not the message named it.
    if (rows.length === 1) trade = rows[0].trade;
    else if (rows.length > 1) {
      /*
       * More than one trade, and the reply named none of them. Nothing is
       * written.
       *
       * This used to stamp every trade line for the pairing, defended in a
       * comment on the grounds that "we can't take this on" and "we're in"
       * are answers about the whole job. Sometimes they are. But a firm
       * paired to HVAC, Electrical and Plumbing who writes "we're in" gets
       * two trades marked responsive that nobody has committed to, and the
       * coverage graph then reads as satisfied for work with no quote behind
       * it. The same sentence read as a decline writes off two trades on one
       * ambiguous line.
       *
       * Either direction is a guess about which trades a person meant, and a
       * person is exactly who should make it. The caller raises a review.
       */
      return { applied: false, refused: "ambiguous_trade", candidateTrades };
    }
  }
  await query(
    `update opportunity_subs
        set outreach_state = $4, responded_at = now()
      where opportunity_id = $1 and subcontractor_id = $2
        and ($3::text is null or coalesce(trade, '') = coalesce($3, ''))`,
    [input.opportunityId, input.subcontractorId, trade, state]
  );

  /*
   * A partly-covered trade still needs covering.
   *
   * The reply was a real price, and the pairing now reads "responded", which
   * on every screen looks like progress. It is progress on part of the work,
   * and the remainder has nobody against it. Flagging the opportunity is what
   * turns "we got a quote" into "we still need the rest of this trade" on
   * Today, so the gap is chased before the bid is assembled around it rather
   * than discovered when the numbers do not add up.
   */
  if (input.outcome === "partial_scope") {
    await query(
      `update opportunities
          set human_action_required = true,
              risk_flags = (
                select array(select distinct unnest(coalesce(risk_flags,'{}') || array['partial_scope_coverage']))
              )
        where id = $1`,
      [input.opportunityId]
    ).catch(() => {});

    /*
     * Go and find someone for the rest of it.
     *
     * Flagging alone leaves the gap sitting on Today waiting for a human to
     * notice, and the whole point of the pipeline is that sourcing does not
     * wait for that. Re-running Sub Finder for THIS trade adds candidates for
     * the uncovered portion.
     *
     * Safe to repeat: the candidate insert upserts on
     * (opportunity, subcontractor, trade), and outreach refuses to email a
     * pairing it has already sent to, so nobody is contacted twice. The
     * singleton key bounds it further, since several subcontractors can each
     * come back partial on the same trade within a few minutes and there is no
     * point sourcing three times over.
     */
    if (trade) {
      const { enqueue } = await import("../queue");
      await enqueue(
        "sub-finder",
        { opportunityId: input.opportunityId, trade, trigger: "partial_scope" },
        {
          singletonKey: `resource:${input.opportunityId}:${trade}`,
          singletonSeconds: 3600,
        }
      ).catch(() => {
        // Sourcing is the follow-up, not the outcome. A queue that refuses the
        // job must not lose the status change that was the point of the call.
      });
    }
  }

  return { applied: true, refused: null, candidateTrades };
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
