/**
 * How many quote requests may leave an account.
 *
 * The daily cap counts outbound mail the provider accepted today, UTC.
 * The trade cap counts distinct subcontractors already sent for one
 * trade on one opportunity. Overflow waits until the next UTC day.
 * The kill switch holds the request and does not schedule another try.
 */

export type RfqHoldReason = "kill_switch" | "daily_cap" | "trade_cap";

export interface RfqVolumeInput {
  outboundEnabled: boolean;
  sentToday: number;
  dailyCap: number;
  sentForTrade: number;
  perTradeCap: number;
  now?: Date;
}

export interface RfqVolumeDecision {
  send: boolean;
  reason: RfqHoldReason | null;
  /** Seconds until the next UTC day, at least 60. Null when nothing is rescheduled. */
  resumeAfterSeconds: number | null;
}

function counted(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** Seconds from `now` until the next UTC midnight, never under a minute. */
export function secondsUntilNextUtcDay(now: Date): number {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return Math.max(60, Math.ceil((next.getTime() - now.getTime()) / 1000));
}

export function decideRfqVolume(input: RfqVolumeInput): RfqVolumeDecision {
  if (!input.outboundEnabled) {
    return { send: false, reason: "kill_switch", resumeAfterSeconds: null };
  }
  const wait = secondsUntilNextUtcDay(input.now ?? new Date());
  if (counted(input.sentToday) >= input.dailyCap) {
    return { send: false, reason: "daily_cap", resumeAfterSeconds: wait };
  }
  if (counted(input.sentForTrade) >= input.perTradeCap) {
    return { send: false, reason: "trade_cap", resumeAfterSeconds: wait };
  }
  return { send: true, reason: null, resumeAfterSeconds: null };
}
