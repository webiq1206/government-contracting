/**
 * When an opportunity is closed, automation must stop.
 *
 * Passing, aborting, and expiring used to change the record the operator
 * sees without stopping work already scheduled: a follow-up still went out,
 * a pending call stayed in the queue, and a recovery sweep could re-queue
 * scoring for a bid nobody was submitting. From a subcontractor's inbox that
 * is an email about a job that was abandoned, sent over the operator's name.
 *
 * This module is the one answer to "may automatic work still run for this
 * record?" It is pure so the expire sweep, the follow-up query, the send
 * guard, and the pass/abort paths cannot drift into different definitions.
 */

export type CloseCause = "passed" | "expired" | "aborted" | "canceled" | "won" | "lost";

export const CLOSE_CAUSE_LABEL: Record<CloseCause, string> = {
  passed: "Passed",
  expired: "Expired",
  aborted: "Aborted",
  canceled: "Canceled",
  won: "Won",
  lost: "Lost",
};

/** Stages that mean the bid is no longer active work. */
export const CLOSED_STAGES = ["dismissed", "won", "lost"] as const;

/** Stages that must never be auto-expired. Submitted bids wait on the agency. */
export const NEVER_EXPIRE_STAGES = ["submitted", "won", "lost"] as const;

/** Bid states that prove a submission is in flight or already sent. */
export const LIVE_SUBMISSION_STATES = [
  "sending",
  "sent",
  "receipt_confirmed",
  "accepted",
] as const;

export interface ClosedRecordFacts {
  status?: string | null;
  stage?: string | null;
  pursuitState?: string | null;
  bidSubmitted?: boolean;
  submissionState?: string | null;
}

/**
 * True when nothing automatic may still run: no follow-up, no outreach, no
 * scoring retry, no call prep. A missing status is treated as open so a
 * half-loaded row does not get a free pass; the send path fails closed
 * separately when it cannot read the row at all.
 */
export function recordIsClosed(facts: ClosedRecordFacts): boolean {
  const status = (facts.status ?? "open").toLowerCase();
  if (status !== "open") return true;
  const stage = (facts.stage ?? "").toLowerCase();
  if ((CLOSED_STAGES as readonly string[]).includes(stage)) return true;
  if (facts.bidSubmitted) return true;
  const submission = (facts.submissionState ?? "").toLowerCase();
  if ((LIVE_SUBMISSION_STATES as readonly string[]).includes(submission)) return true;
  return false;
}

/**
 * Whether a follow-up email may still go out.
 *
 * Submitted work is closed for chasing even though the opportunity stays
 * open: the agency now has the package, and asking a sub for a price after
 * that is the wrong message at the wrong time.
 */
export function followUpMaySend(facts: ClosedRecordFacts): boolean {
  if (recordIsClosed(facts)) return false;
  if ((facts.stage ?? "").toLowerCase() === "submitted") return false;
  const pursuit = facts.pursuitState == null || facts.pursuitState === ""
    ? "active"
    : facts.pursuitState;
  return pursuit === "active";
}

export interface ExpireFacts {
  status?: string | null;
  stage?: string | null;
  deadline?: string | Date | null;
  now: Date;
  bidSubmitted?: boolean;
  submissionState?: string | null;
  /** Operator or amendment override: keep working past the printed deadline. */
  keepOpen?: boolean;
}

/**
 * Whether the expire sweep may archive this opportunity.
 *
 * A submitted or in-flight bid is never expired. A missing deadline is never
 * expired. An amendment that moved the deadline into the future is already
 * reflected in `deadline`, so this function does not need a second clock.
 */
export function mayExpireOpportunity(facts: ExpireFacts): boolean {
  if (facts.keepOpen) return false;
  if ((facts.status ?? "open") !== "open") return false;
  const stage = (facts.stage ?? "").toLowerCase();
  if ((NEVER_EXPIRE_STAGES as readonly string[]).includes(stage)) return false;
  if (facts.bidSubmitted) return false;
  const submission = (facts.submissionState ?? "").toLowerCase();
  if ((LIVE_SUBMISSION_STATES as readonly string[]).includes(submission)) return false;
  if (!facts.deadline) return false;
  const deadline = facts.deadline instanceof Date ? facts.deadline : new Date(facts.deadline);
  if (!Number.isFinite(deadline.getTime())) return false;
  return deadline.getTime() < facts.now.getTime();
}

export function closedRecordReason(facts: ClosedRecordFacts): string {
  const status = (facts.status ?? "open").toLowerCase();
  if (status !== "open") {
    return "This opportunity is closed, so nothing automatic runs for it.";
  }
  const stage = (facts.stage ?? "").toLowerCase();
  if (stage === "dismissed") {
    return "This opportunity was passed on, so outreach and follow-ups have stopped.";
  }
  if (stage === "won") {
    return "This opportunity was won. Outreach for the bid has stopped.";
  }
  if (stage === "lost") {
    return "This opportunity was lost. Outreach for the bid has stopped.";
  }
  if (facts.bidSubmitted || (LIVE_SUBMISSION_STATES as readonly string[]).includes((facts.submissionState ?? "").toLowerCase())) {
    return "A bid was already submitted, so chasing subcontractors has stopped.";
  }
  return "This opportunity is no longer active work.";
}
