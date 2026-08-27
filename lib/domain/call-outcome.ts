/**
 * How a call ended, and what that means for everything downstream.
 *
 * The workspace offered five outcomes and the save route decided what each one
 * meant by comparing strings in four separate places: whether the pairing had
 * declined, whether to run the decline close-out, whether the sub had answered
 * at all. Adding a sixth outcome meant finding every one of those comparisons
 * and remembering to extend it, and the failure mode of forgetting is silent:
 * a firm that said "wrong number" reads as a firm that engaged.
 *
 * So the meaning of an outcome lives here, once, as data. The route asks this
 * module what an outcome implies rather than deciding for itself.
 *
 * The eleven are the ones a real call actually ends in. Several of them look
 * alike from a distance and are completely different to the person working the
 * queue: "no answer" is a call to make again this afternoon, "wrong number" is
 * a contact record to fix before anybody calls again, and "does not perform
 * this trade" is a sourcing mistake that should stop this firm being offered
 * for that trade at all.
 */

export const CALL_OUTCOMES = [
  "interested",
  "quote_provided",
  "needs_follow_up",
  "call_back_later",
  "no_answer",
  "wrong_number",
  "different_contact",
  "partial_scope",
  "pass",
  "does_not_perform",
  "not_qualified",
] as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const CALL_OUTCOME_LABEL: Record<CallOutcome, string> = {
  interested: "Interested, no price yet",
  quote_provided: "Gave a price",
  needs_follow_up: "Needs a follow-up",
  call_back_later: "Call back at a set time",
  no_answer: "No answer",
  wrong_number: "Wrong number",
  different_contact: "Someone else handles this",
  partial_scope: "Can only do part of it",
  pass: "Passed on the job",
  does_not_perform: "Does not do this trade",
  not_qualified: "Cannot meet the requirements",
};

/** One line saying what the outcome means, for the operator choosing it. */
export const CALL_OUTCOME_HINT: Record<CallOutcome, string> = {
  interested: "They want the work and have not priced it yet.",
  quote_provided: "They gave you a number. Record it above.",
  needs_follow_up: "Something is outstanding before they can price it.",
  call_back_later: "They asked to be called at a particular time.",
  no_answer: "Nobody picked up. Nothing about this firm has changed.",
  wrong_number: "The number does not reach them. Fix it before anybody calls again.",
  different_contact: "The right person is somebody else at the same firm.",
  partial_scope: "They can do some of the trade but not all of it.",
  pass: "They can do the work and do not want it.",
  does_not_perform: "They do not do this trade at all. Sourcing got it wrong.",
  not_qualified: "They want it and cannot meet the bonding, licence or insurance requirements.",
};

/**
 * What the pairing on this bid becomes.
 *
 * `unchanged` is a real answer and the important one: a call nobody answered
 * has told us nothing, and moving the pairing to `responsive` on the strength
 * of a ringing phone is the platform inventing a conversation.
 */
export type PairingEffect = "declined" | "responsive" | "unchanged";

export interface OutcomeEffect {
  pairing: PairingEffect;
  /**
   * Whether to run the decline close-out: thank them, skip their other pending
   * cards, and stop chasing. Reserved for a firm that is out of this trade on
   * this bid, which is not the same as one who simply did not answer.
   */
  closeOut: boolean;
  /** Whether a date and time are required before the outcome can be saved. */
  needsCallBackTime: boolean;
  /** Whether the operator has to name the person who actually handles it. */
  needsContactName: boolean;
  /** Whether the contact details are known to be wrong. */
  contactBroken: boolean;
  /**
   * Whether this firm should stop being offered for this trade generally,
   * rather than just on this bid. Only for the two answers that are about the
   * firm rather than about the job.
   */
  capabilityMismatch: boolean;
  /** Whether they cover only part of the trade, so the rest needs sourcing. */
  partialCoverage: boolean;
}

const EFFECTS: Record<CallOutcome, OutcomeEffect> = {
  interested: eff({ pairing: "responsive" }),
  quote_provided: eff({ pairing: "responsive" }),
  needs_follow_up: eff({ pairing: "responsive" }),
  call_back_later: eff({ pairing: "responsive", needsCallBackTime: true }),
  /*
   * A ringing phone is not a state change. The prior outreach state stands,
   * the follow-up schedule stands, and nothing about this firm is now known
   * that was not known before the call.
   */
  no_answer: eff({ pairing: "unchanged" }),
  /*
   * Also unchanged, and for a stronger reason: we have not reached this firm
   * at all. Marking them declined would record a refusal from somebody who was
   * never asked.
   */
  wrong_number: eff({ pairing: "unchanged", contactBroken: true }),
  different_contact: eff({ pairing: "unchanged", needsContactName: true }),
  partial_scope: eff({ pairing: "responsive", partialCoverage: true }),
  pass: eff({ pairing: "declined", closeOut: true }),
  does_not_perform: eff({ pairing: "declined", closeOut: true, capabilityMismatch: true }),
  not_qualified: eff({ pairing: "declined", closeOut: true, capabilityMismatch: true }),
};

function eff(p: Partial<OutcomeEffect> & { pairing: PairingEffect }): OutcomeEffect {
  return {
    closeOut: false,
    needsCallBackTime: false,
    needsContactName: false,
    contactBroken: false,
    capabilityMismatch: false,
    partialCoverage: false,
    ...p,
  };
}

export function isCallOutcome(v: unknown): v is CallOutcome {
  return (CALL_OUTCOMES as readonly string[]).includes(String(v));
}

/**
 * What one outcome implies. Unknown outcomes change nothing.
 *
 * Failing to `unchanged` rather than to a guess: an outcome this build does
 * not recognise came from somewhere, and the safe reading of an unrecognised
 * answer is that we learned nothing, not that the firm declined.
 */
export function outcomeEffect(outcome: string | null | undefined): OutcomeEffect {
  return isCallOutcome(outcome) ? EFFECTS[outcome] : eff({ pairing: "unchanged" });
}

/**
 * The outcomes an older record may still carry, mapped onto the current set.
 *
 * The workspace shipped with five, and the ones already written to
 * `call_cards.response_json` do not change because a newer build has a longer
 * list. A record page that could not read them would show a completed call
 * with no outcome, which reads as a call nobody finished.
 */
const LEGACY: Record<string, CallOutcome> = {
  success: "quote_provided",
  not_interested: "pass",
  declined: "pass",
  // "skipped" is not an outcome of a call. It is the absence of one, and the
  // card status carries it, so it deliberately has no mapping here.
};

export function normalizeOutcome(raw: string | null | undefined): CallOutcome | null {
  const v = String(raw ?? "").toLowerCase().trim();
  if (!v) return null;
  if (isCallOutcome(v)) return v;
  return LEGACY[v] ?? null;
}

/**
 * Whether the outcome can be saved, given what else was filled in.
 *
 * Two outcomes carry an obligation. "Call back at a set time" without a time
 * is a promise nobody can keep, and "someone else handles this" without a name
 * is the same call to make again tomorrow with the same result.
 */
export function outcomeComplete(
  outcome: string | null | undefined,
  fields: { callBackAt?: string | null; contactName?: string | null }
): { ok: true } | { ok: false; reason: string } {
  const effect = outcomeEffect(outcome);
  if (effect.needsCallBackTime && !(fields.callBackAt ?? "").trim()) {
    return { ok: false, reason: "Say when to call back. Without a time this is just a note." };
  }
  if (effect.needsContactName && !(fields.contactName ?? "").trim()) {
    return {
      ok: false,
      reason: "Name the person who handles it, or the next call reaches the same dead end.",
    };
  }
  return { ok: true };
}
