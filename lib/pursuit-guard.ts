/**
 * The check every piece of automation makes before it acts on an opportunity.
 *
 * lib/domain/pursuit-state.ts decides what a state means. This goes and gets
 * it, and is the only thing agents and send paths need to call.
 *
 * Two rules govern how it is used, and both matter more than they look:
 *
 * 1. It is checked as late as possible, immediately before the write, send or
 *    enqueue. A job that read "active" when it started and is about to send
 *    four minutes later has stale knowledge, and four minutes is long enough
 *    for somebody to have pressed Abort while watching the email they did not
 *    want go out.
 *
 * 2. It fails closed. A database error here returns "may not act", not "may
 *    act": the alternative is that a blip re-enables outreach on every
 *    aborted pursuit at once, which is the single worst outcome available and
 *    would arrive as a wave of emails about jobs nobody is bidding.
 */
import { queryOne } from "./db";
import {
  parsePursuitState,
  pursuitVerdict,
  type PursuitState,
  type PursuitVerdict,
} from "./domain/pursuit-state";
import { closedRecordReason, recordIsClosed } from "./domain/closed-work";
import { expectedPursuitVersion } from "./pursuit-job-context";

export interface PursuitStatus extends PursuitVerdict {
  state: PursuitState;
  /** Monotonic generation used to fence work queued before an abort/restart. */
  version: number | null;
  /** False when the opportunity could not be read at all. */
  known: boolean;
  /** Whether a caller should preserve scheduled work and try this check later. */
  retryable: boolean;
}

/**
 * May automation act on this opportunity right now?
 *
 * A missing opportunity answers no. The row being gone is not permission; it
 * is the absence of anything to act on, and the callers that care about the
 * difference already handle deletion separately through payloadOrgId.
 */
export async function pursuitStatus(opportunityId: string): Promise<PursuitStatus> {
  if (!opportunityId) {
    return {
      state: "aborted",
      version: null,
      mayAct: false,
      known: false,
      retryable: false,
      reason: "No opportunity was named.",
    };
  }
  let row: {
    pursuit_state: string;
    pursuit_reason: string | null;
    status: string | null;
    stage: string | null;
    pursuit_version: number | null;
  } | null;
  try {
    row = await queryOne<{
      pursuit_state: string;
      pursuit_reason: string | null;
      status: string | null;
      stage: string | null;
      pursuit_version: number | null;
    }>(
      `select pursuit_state, pursuit_reason, status, stage, pursuit_version
         from opportunities where id = $1`,
      [opportunityId]
    );
  } catch {
    /*
     * Fail closed. See the header: reading a database error as permission
     * would turn one blip into outreach resuming on every stopped pursuit.
     */
    return {
      state: "aborted",
      version: null,
      mayAct: false,
      known: false,
      retryable: true,
      reason: "Could not read whether this pursuit is still active, so nothing was sent.",
    };
  }
  if (!row) {
    return {
      state: "aborted",
      version: null,
      mayAct: false,
      known: false,
      retryable: false,
      reason: "The opportunity no longer exists.",
    };
  }
  const state = parsePursuitState(row.pursuit_state);
  const version = Number(row.pursuit_version);
  if (!Number.isInteger(version) || version < 1) {
    return {
      state,
      version: null,
      known: true,
      mayAct: false,
      retryable: true,
      reason: "The pursuit version could not be verified, so this job was stopped.",
    };
  }
  const expected = expectedPursuitVersion(opportunityId);
  if (expected != null && expected !== version) {
    return {
      state,
      version,
      known: true,
      mayAct: false,
      retryable: false,
      reason:
        "This job belongs to an earlier version of the pursuit. It was stopped so an abort and restart cannot revive stale work.",
    };
  }
  if (
    recordIsClosed({
      status: row.status,
      stage: row.stage,
      pursuitState: state,
    })
  ) {
    return {
      state,
      version,
      known: true,
      mayAct: false,
      retryable: false,
      reason: closedRecordReason({ status: row.status, stage: row.stage }),
    };
  }
  const verdict = pursuitVerdict({ state, reason: row.pursuit_reason });
  return {
    state,
    version,
    known: true,
    retryable: verdict.mayAct || state === "paused",
    ...verdict,
  };
}

/**
 * Throw unless automation may act.
 *
 * For call sites where continuing would be a bug rather than a branch: the
 * agent runner catches it, records it against the run, and the queue does not
 * retry, because a paused pursuit is not a transient failure.
 */
export class PursuitStoppedError extends Error {
  readonly state: PursuitState;
  constructor(status: PursuitStatus) {
    super(status.reason ?? "This pursuit is not active.");
    this.name = "PursuitStoppedError";
    this.state = status.state;
  }
}

export async function assertPursuitActive(opportunityId: string): Promise<void> {
  const status = await pursuitStatus(opportunityId);
  if (!status.mayAct) throw new PursuitStoppedError(status);
}
