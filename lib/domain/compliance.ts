/**
 * Compliance domain logic — pure and deterministic (unit-tested). Maps a
 * days-remaining figure to a status using the profile's alert cadences (SYS-08),
 * and computes the non-small-business sub spend cap state per contract.
 */

export type ComplianceStatus = "ok" | "warning" | "critical" | "blocked" | "resolved";

/**
 * Deadline status from days remaining and an alert-day cadence like [90,30,7].
 * - <= smallest threshold (or negative)  -> critical (or blocked at/after 0)
 * - <= a larger threshold                 -> warning
 * - otherwise                             -> ok
 * `blockAtZero` marks items that block an action once expired (e.g. SAM reg).
 */
export function deadlineStatus(
  daysRemaining: number,
  alertDays: number[],
  opts: { blockAtZero?: boolean } = {}
): ComplianceStatus {
  const sorted = [...alertDays].sort((a, b) => a - b);
  const smallest = sorted[0] ?? 7;
  const largest = sorted[sorted.length - 1] ?? smallest;

  if (daysRemaining <= 0) return opts.blockAtZero ? "blocked" : "critical";
  if (daysRemaining <= smallest) return "critical";
  if (daysRemaining <= largest) return "warning";
  return "ok";
}

export function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / 86_400_000);
}

/** Color for the compliance board (green/amber/red). */
export function statusColor(status: ComplianceStatus): "green" | "amber" | "red" {
  switch (status) {
    case "ok":
    case "resolved":
      return "green";
    case "warning":
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
  let status: ComplianceStatus = "ok";
  if (nonSsPct >= blockThreshold) status = "blocked";
  else if (nonSsPct >= alertPct) status = "warning";
  return {
    utilizationPct: nonSsPct,
    status,
    blockAdditional: nonSsPct >= blockThreshold,
    alert: nonSsPct >= alertPct,
  };
}
