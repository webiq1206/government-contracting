/**
 * Whether a dropped pursue handoff may be queued again.
 *
 * A step that already finished stays finished, including a subcontractor
 * search that paired nobody and a verification that left the email unverified.
 * A step that never started is queued. A step that was interrupted is queued
 * again, with a cap and a longer wait after each failure. Paid lookups use
 * the same cap so one item cannot be billed on every sweep.
 */

export const HANDOFF_ATTEMPT_CAP = 3;

const BACKOFF_MS = [10 * 60_000, 30 * 60_000, 60 * 60_000];

export function handoffBackoffMs(attempts: number): number {
  const index = Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1;
  return BACKOFF_MS[index];
}

export function handoffKey(agent: string, opportunityId: string, subcontractorId = "", trade = ""): string {
  return agent === "sub-verify" || agent === "outreach"
    ? `${agent}:${opportunityId}:${subcontractorId}:${trade}`
    : `${agent}:${opportunityId}`;
}

export function handoffAdmission(input: {
  finished: boolean;
  attempts: number;
  lastAttemptAt: Date | null;
  inFlight: boolean;
  now: Date;
  interrupted: boolean;
}): "queue" | "skip" | "wait" | "cap" {
  if (input.inFlight) return "skip";
  if (input.finished) return "skip";
  if (!input.interrupted && input.attempts === 0) return "queue";
  if (!input.interrupted) return "skip";
  if (input.attempts >= HANDOFF_ATTEMPT_CAP) return "cap";
  if (
    input.lastAttemptAt &&
    input.now.getTime() - input.lastAttemptAt.getTime() < handoffBackoffMs(input.attempts)
  ) {
    return "wait";
  }
  return "queue";
}
