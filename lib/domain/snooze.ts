/**
 * Shared snooze "until" parsing for single and bulk Today/queue hides.
 */

export type SnoozeUntilChoice = "tomorrow" | "3d";

/** Resolve a snooze choice to a Date (local 07:00), or null when waking. */
export function resolveSnoozeUntil(
  until: SnoozeUntilChoice | null | undefined
): Date | null {
  if (until == null) return null;
  if (until === "tomorrow") {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(7, 0, 0, 0);
    return d;
  }
  if (until === "3d") {
    const d = new Date(Date.now() + 3 * 86_400_000);
    d.setHours(7, 0, 0, 0);
    return d;
  }
  throw new Error('until must be "tomorrow", "3d", or null.');
}

export function snoozeUntilLabel(until: SnoozeUntilChoice): string {
  return until === "tomorrow" ? "tomorrow morning" : "3 days from now";
}
