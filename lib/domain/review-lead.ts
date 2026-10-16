/**
 * How close a response deadline is, counted in business days.
 *
 * Weekends are not lead time. A bid that closes on Monday does not have
 * the weekend to find subcontractors and collect prices.
 */

export const DEFAULT_REVIEW_LEAD_BUSINESS_DAYS = 5;

export const LEAD_PASS_NOTE =
  "Passed: the response deadline is already past or inside the minimum lead time, so there is not enough time to price and submit.";

/** Midnight-preserving walk that skips Saturday and Sunday. */
export function addBusinessDays(start: Date, days: number): Date {
  const cursor = new Date(start.getTime());
  let left = Math.max(0, Math.floor(days));
  while (left > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) left -= 1;
  }
  return cursor;
}

/**
 * True when the deadline is already past or falls before `businessDays`
 * full business days from now. Zero business days turns the rule off.
 */
export function closesInsideLeadTime(
  deadline: Date,
  now: Date,
  businessDays: number
): boolean {
  if (!Number.isFinite(businessDays) || businessDays <= 0) return false;
  if (Number.isNaN(deadline.getTime()) || Number.isNaN(now.getTime())) return false;
  return deadline.getTime() < addBusinessDays(now, businessDays).getTime();
}
