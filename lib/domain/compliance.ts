/**
 * Compliance domain logic, pure and deterministic (unit-tested). Maps a
 * days-remaining figure to a status using the profile's alert cadences (SYS-08),
 * and computes the non-small-business sub spend cap state per contract.
 */

import type { ComplianceState } from "./compliance-state";

export type { ComplianceState };

/**
 * The vocabulary moved.
 *
 * `ok | warning | critical | blocked | resolved` were three severity words and
 * two states. "Critical" said how urgent something was, not what was true
 * about it, so a missing certificate, a lapsed one and one whose two sources
 * disagreed all read the same. lib/domain/compliance-state.ts holds the eight
 * that say what is true, and this alias keeps the old name pointing at them
 * for the code that still reads it.
 */
export type ComplianceStatus = ComplianceState;

/**
 * Deadline state from days remaining and an alert-day cadence like [90,30,7].
 *
 * - past due                             -> expired (or blocked at/after 0
 *                                           when a lapse stops an action)
 * - inside the cadence                   -> expiring_soon
 * - outside it                           -> complete
 *
 * Note what the last line no longer says. It used to return `ok`, which the
 * page rendered as a green badge, including for an item whose expiry date
 * nobody had ever supplied. This function is only ever called with a real number of
 * days remaining, so `complete` here is a statement about a date that exists.
 * An item with no date does not reach this function at all.
 */
export function deadlineStatus(
  daysRemaining: number,
  alertDays: number[],
  opts: { blockAtZero?: boolean } = {}
): ComplianceState {
  const sorted = [...alertDays].sort((a, b) => a - b);
  const largest = sorted[sorted.length - 1] ?? sorted[0] ?? 7;

  if (daysRemaining <= 0) return opts.blockAtZero ? "blocked" : "expired";
  /*
   * One threshold, not two. The old function split the cadence into "warning"
   * and "critical" bands, which was severity dressed up as state: both meant
   * the same thing, that a dated item is inside its warning window, and the
   * only honest difference between them is the number of days, which is shown
   * anyway.
   */
  if (daysRemaining <= largest) return "expiring_soon";
  return "complete";
}

export function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / 86_400_000);
}

/** Color for the compliance board (green/amber/red). */
export function statusColor(status: ComplianceState): "green" | "amber" | "red" {
  switch (status) {
    case "complete":
      return "green";
    case "expiring_soon":
    case "needs_review":
      return "amber";
    case "cannot_monitor":
    case "incomplete":
      /*
       * Amber, not green. Neither of these is a problem today and neither is
       * finished, and the old mapping had no bucket for that: everything the
       * monitor had not flagged went green, which is how an item nobody could
       * check ended up looking as settled as one renewed last week.
       */
      return "amber";
    default:
      return "red";
  }
}

export interface CapState {
  utilizationPct: number;
  status: ComplianceStatus;
  blockAdditional: boolean; // block new non-SS subs
  alert: boolean;
}

/**
 * Non-small-business sub spend cap. Alert at alertPct (45), block additional at
 * (capPct - 1) i.e. 49 when cap is 50 (spec: "Block additional non-SS subs at 49%").
 */
export function nonSsCapState(
  nonSsPct: number,
  capPct: number,
  alertPct: number
): CapState {
  const blockThreshold = capPct - 1;
  let status: ComplianceState = "complete";
  if (nonSsPct >= blockThreshold) status = "blocked";
  else if (nonSsPct >= alertPct) status = "expiring_soon";
  return {
    utilizationPct: nonSsPct,
    status,
    blockAdditional: nonSsPct >= blockThreshold,
    alert: nonSsPct >= alertPct,
  };
}
