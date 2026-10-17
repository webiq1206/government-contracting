/**
 * Keep the morning recap under Gmail's send rate.
 *
 * A tick used to hand the mailbox twenty-five messages six hundred
 * milliseconds apart. A 429 then marked the row failed, and the next tick
 * claimed that failure again. If Gmail had already accepted the message, the
 * second claim was a duplicate.
 */

export const RECAP_SENDS_PER_TICK = 8;
const GAP_MIN_MS = 2_000;
const GAP_JITTER_MS = 800;

export function isMailboxRateLimit(error: string | null | undefined): boolean {
  return /rate.?limit|too many requests|\b429\b|quota exceeded|user-rate limit/i.test(error ?? "");
}

/** Space between two sends in one tick. `random` is 0..1. */
export function recapGapMs(random = Math.random()): number {
  const unit = Math.min(1, Math.max(0, random));
  return GAP_MIN_MS + Math.floor(unit * GAP_JITTER_MS);
}

/**
 * How long to wait before claiming a rate-limited row again.
 * Attempt 1 waits about 2 minutes; later attempts double, capped at an hour,
 * with a little jitter so a whole list does not wake up together.
 */
export function recapRetryDelayMs(attempts: number, random = Math.random()): number {
  const step = Math.min(5, Math.max(0, Math.floor(attempts) - 1));
  const base = Math.min(60 * 60_000, 2 * 60_000 * 2 ** step);
  const unit = Math.min(1, Math.max(0, random));
  return base + Math.floor(unit * base * 0.25);
}

/**
 * A failed row may be claimed again only when no message could exist, or
 * Gmail explicitly rate-limited a send that did not return a message id and
 * the backoff has elapsed. The claim itself stops at three attempts, so a
 * rate limit does not get a longer automatic run, and a saved message id is
 * never claimed again.
 */
export function recapFailureCanRetry(input: {
  providerAttemptedAt: string | null;
  providerMessageId: string | null;
  error: string | null;
  nextRetryAt: string | null;
  now: Date;
}): boolean {
  if (input.providerMessageId) return false;
  if (!input.providerAttemptedAt) return true;
  if (!isMailboxRateLimit(input.error)) return false;
  if (!input.nextRetryAt) return true;
  const at = new Date(input.nextRetryAt).getTime();
  return Number.isFinite(at) && at <= input.now.getTime();
}
