/**
 * Whether automation may act on an opportunity, and what to say when it may
 * not.
 *
 * The product could dismiss an opportunity and could move it between stages.
 * Neither stops work already in flight. A queued follow-up still goes out, a
 * recovery sweep still re-enqueues a scoring job, Sub Finder still sources
 * candidates for a bid nobody intends to submit. From the subcontractor's side
 * that is an email about a job that was abandoned days ago, sent over the
 * operator's name, and the operator has no way to know it happened.
 *
 * So there is one marker and one question. Every send, enqueue, state change
 * and external call asks the question before it acts.
 *
 * Pure on purpose: the caller reads the row, this decides what it means. The
 * decision is the part worth testing exhaustively, and it cannot be while it
 * is welded to a query.
 */

/** The only state in which automation may act, and the two in which it may not. */
export type PursuitState = "active" | "paused" | "aborted";

export const PURSUIT_STATES: readonly PursuitState[] = ["active", "paused", "aborted"];

/**
 * Anything unrecognised is treated as stopped.
 *
 * A column written by a future migration, a typo, a value from a restore: all
 * of them mean this code does not know what it is looking at. Reading an
 * unknown state as "active" would resume outreach on the strength of not
 * understanding the record, which is the worst available answer.
 */
export function parsePursuitState(raw: unknown): PursuitState {
  return raw === "active" || raw === "paused" || raw === "aborted" ? raw : "aborted";
}

/** What an opportunity's row says about whether work may continue. */
export interface PursuitFacts {
  state: PursuitState;
  /** Structured reason, when a person gave one. */
  reason?: string | null;
  /** The operator's own note, when they added one. */
  note?: string | null;
  /** Bumped on every abort and restart. */
  version?: number | null;
}

export interface PursuitVerdict {
  /** True only when automation may read, write, enqueue, and send. */
  mayAct: boolean;
  /**
   * Why not, in a sentence an operator would recognise. Null when it may act.
   *
   * Written for an agent log rather than for a developer: the audience is
   * somebody wondering why an opportunity went quiet, not somebody debugging
   * the guard.
   */
  reason: string | null;
}

/**
 * The one question.
 *
 * Note what this does NOT consider: the stage, the deadline, whether the
 * package is ready. Those are questions about the work. This is the question
 * about permission, and mixing them is how a guard ends up with an exception
 * that lets one caller through.
 */
export function pursuitVerdict(facts: PursuitFacts): PursuitVerdict {
  if (facts.state === "active") return { mayAct: true, reason: null };
  const because = facts.reason ? ` (${facts.reason})` : "";
  if (facts.state === "paused") {
    return {
      mayAct: false,
      reason:
        `This pursuit is paused${because}, so nothing automatic runs for it. ` +
        `Everything is preserved and resuming picks it up where it stopped.`,
    };
  }
  return {
    mayAct: false,
    reason:
      `This pursuit was aborted${because}, so no further automatic work runs for it. ` +
      `Its history is kept and readable. Restarting requires a full revalidation ` +
      `rather than resuming, because the solicitation may have moved on.`,
  };
}

/**
 * The structured reasons an abort may carry.
 *
 * A free-text-only reason makes the abort unreportable: "why do we abandon
 * pursuits" is a question the analytics should be able to answer, and it
 * cannot if every answer is a sentence somebody typed. `other` still requires
 * a note, so nothing is lost.
 */
export const ABORT_REASONS = [
  "no_longer_eligible",
  "requirements_changed",
  "insufficient_coverage",
  "pricing_unacceptable",
  "deadline_unreachable",
  "missing_mandatory_information",
  "excessive_risk",
  "agency_cancelled",
  "duplicate",
  "strategic",
  "other",
] as const;
export type AbortReason = (typeof ABORT_REASONS)[number];

export const ABORT_REASON_LABEL: Record<AbortReason, string> = {
  no_longer_eligible: "No longer eligible",
  requirements_changed: "Requirements changed",
  insufficient_coverage: "Not enough subcontractor coverage",
  pricing_unacceptable: "Pricing or margin unacceptable",
  deadline_unreachable: "Deadline cannot be met",
  missing_mandatory_information: "Missing mandatory information",
  excessive_risk: "Performance or compliance risk too high",
  agency_cancelled: "The agency cancelled or withdrew it",
  duplicate: "Duplicate of another opportunity",
  strategic: "Strategic decision",
  other: "Other",
};

export function isAbortReason(v: unknown): v is AbortReason {
  return typeof v === "string" && (ABORT_REASONS as readonly string[]).includes(v);
}

/**
 * Whether an abort request is complete enough to commit.
 *
 * `other` without a note is the case this exists for. It is the reason
 * somebody picks when none of the others fit, so it is the one that most needs
 * the sentence, and it is also the easiest to leave blank.
 */
export function abortRequestProblem(input: {
  reason?: unknown;
  note?: unknown;
}): string | null {
  if (!isAbortReason(input.reason)) {
    return "Choose a reason for aborting this pursuit.";
  }
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (input.reason === "other" && note.length < 3) {
    return 'Describe the reason, since "Other" does not say one.';
  }
  return null;
}

/**
 * What a restart must do before automation may act again.
 *
 * Deliberately not a list of things to display. It is the set of checks the
 * restart path has to run, named here so the path and the confirmation screen
 * cannot drift into describing different work.
 *
 * A one-click resume is the thing this prevents: reviving stale packets and
 * stale scoring against a solicitation that may have been amended twice since
 * the abort is how an aborted pursuit becomes a wrong bid rather than no bid.
 */
export const RESTART_REVALIDATION = [
  "The notice is still open and the deadline has not passed",
  "The solicitation and every amendment are re-fetched",
  "Eligibility, score, requirements and trade scopes are rebuilt from current facts",
  "Outreach packets are rebuilt, and none is sent without approval",
  "Quotes are re-checked against the current scope",
] as const;
