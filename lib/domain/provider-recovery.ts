/**
 * When a refused AI provider may be tested again, and which unscored
 * review items that success is allowed to put back.
 *
 * Pure. The probe, the incident row and the queue live elsewhere. The
 * refusal itself is cleared only by a successful probeProviderRecovery
 * call, which is the existing recovery path.
 */

import { addBusinessDays } from "./review-lead";

export const PROBE_BACKOFF_MS = [
  10 * 60_000,
  30 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
] as const;

/** Wait after the failure that just happened. The first failure waits 10 minutes. */
export function backoffAfterFailure(failureCountAfterThisAttempt: number): number {
  const count = Math.max(1, Math.floor(failureCountAfterThisAttempt));
  const index = Math.min(count, PROBE_BACKOFF_MS.length) - 1;
  return PROBE_BACKOFF_MS[index];
}

export function probeIsDue(input: {
  refusalHeld: boolean;
  attemptPending: boolean;
  nextProbeAt: Date | string | null;
  now: Date;
}): boolean {
  if (!input.refusalHeld || input.attemptPending) return false;
  if (input.nextProbeAt == null) return true;
  const at = new Date(input.nextProbeAt).getTime();
  return Number.isFinite(at) && at <= input.now.getTime();
}

const SCORING_STAGES = new Set(["monitoring", "scoring"]);

export interface RescoreRow {
  id: string;
  tier: string | null;
  status: string | null;
  stage: string;
  riskFlags: readonly string[];
  /** The solicitation response deadline. Column name is `deadline`. */
  deadline: Date | string | null;
}

/**
 * Review items a recovered provider should score again.
 *
 * Far enough out means the deadline is outside the account's minimum bid
 * lead time. Items inside that window are passed instead of scored again.
 * When the lead-time rule is off, the floor is 24 hours.
 */
export function eligibleForRescore(
  row: RescoreRow,
  now: Date,
  leadBusinessDays = 5
): boolean {
  if (row.tier !== "review" || row.status !== "open") return false;
  if (!SCORING_STAGES.has(row.stage)) return false;
  if (!row.riskFlags.includes("incomplete_scoring")) return false;
  if (row.deadline == null) return false;
  const deadline = new Date(row.deadline).getTime();
  if (!Number.isFinite(deadline)) return false;
  const floor =
    leadBusinessDays > 0
      ? addBusinessDays(now, leadBusinessDays).getTime()
      : now.getTime() + 24 * 60 * 60_000;
  return deadline >= floor;
}

/** Stable for one incident, so a second probe cannot queue the same rescore. */
export function rescoreKey(opportunityId: string, incidentId: string): string {
  return `rescore:${opportunityId}:${incidentId}`;
}

export function providerRefusalCause(provider: string): string {
  return `provider_refusal:${provider.trim().toLowerCase()}`;
}
