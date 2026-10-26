/**
 * BrostCo outreach send window.
 *
 * The worker, the scheduler, and Node's process timezone are the wrong clock.
 * A cron of star-slash-15 fires all night in whatever zone the host uses, and
 * Date#getHours() would open the gate on that host clock. Quote requests,
 * follow-ups, sources-sought sends, and other outreach may leave only during
 * weekday business hours in America/Boise.
 *
 * The zone is the product zone, written here and passed to Intl. It is not
 * America/Denver, not UTC, and not the zone the process happened to start in.
 * Mountain Time still changes: after the fall-back, 15:00 UTC is 8:00 in
 * Boise, not 9:00. Intl applies that shift. A fixed offset would not.
 */

export const OUTREACH_SEND_TIME_ZONE = "America/Boise" as const;
/** 9:00 AM inclusive. */
export const OUTREACH_SEND_OPEN_HOUR = 9;
/** 5:00 PM exclusive. 4:59 PM is the last open minute. */
export const OUTREACH_SEND_CLOSE_HOUR = 17;

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const wallClock = new Intl.DateTimeFormat("en-US", {
  timeZone: OUTREACH_SEND_TIME_ZONE,
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export interface OutreachLocalParts {
  /** 0 Sunday through 6 Saturday, on the America/Boise calendar date. */
  weekday: number;
  hour: number;
  minute: number;
  year: number;
  month: number;
  day: number;
}

export interface OutreachSendWindowDecision extends OutreachLocalParts {
  open: boolean;
  timeZone: typeof OUTREACH_SEND_TIME_ZONE;
  reason: string;
}

export interface OutreachWindowRefusal {
  disabled: true;
  retryable: true;
  outcome: "not_attempted";
  heldForSendWindow: true;
  error: string;
}

/** The zone Intl actually resolved. Tests use this to prove the pin. */
export function outreachSendTimeZone(): string {
  return wallClock.resolvedOptions().timeZone;
}

/** Wall clock in America/Boise. Never the process zone. */
export function outreachLocalParts(at: Date): OutreachLocalParts {
  const parts = wallClock.formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const weekday = WEEKDAY_INDEX[read("weekday")];
  if (weekday == null) {
    throw new Error(
      `America/Boise weekday could not be read from ${read("weekday") || "an empty value"}.`
    );
  }
  // Some ICU builds render midnight as hour 24 under hourCycle h23.
  let hour = Number(read("hour"));
  if (hour === 24) hour = 0;
  return {
    weekday,
    hour,
    minute: Number(read("minute")),
    year: Number(read("year")),
    month: Number(read("month")),
    day: Number(read("day")),
  };
}

export const OUTREACH_SEND_WINDOW_REASON =
  "Held for America/Boise weekday business hours (Monday–Friday, 9:00 AM–5:00 PM local). Nothing was sent. The next in-window run will send it.";

/**
 * Monday–Friday, hour >= 9 and hour < 17, in America/Boise.
 * 9:00 AM is open. 5:00 PM is closed.
 */
export function evaluateOutreachSendWindow(at: Date = new Date()): OutreachSendWindowDecision {
  const local = outreachLocalParts(at);
  const open =
    local.weekday >= 1 &&
    local.weekday <= 5 &&
    local.hour >= OUTREACH_SEND_OPEN_HOUR &&
    local.hour < OUTREACH_SEND_CLOSE_HOUR;
  return {
    open,
    timeZone: OUTREACH_SEND_TIME_ZONE,
    ...local,
    reason: open
      ? "Within America/Boise weekday business hours."
      : OUTREACH_SEND_WINDOW_REASON,
  };
}

/**
 * Refusal for a provider send outside the window.
 * Retryable and not a permanent failure: the next in-window run sends it.
 * Null while the window is open.
 */
export function outreachWindowRefusal(at: Date = new Date()): OutreachWindowRefusal | null {
  const decision = evaluateOutreachSendWindow(at);
  if (decision.open) return null;
  return {
    disabled: true,
    retryable: true,
    outcome: "not_attempted",
    heldForSendWindow: true,
    error: decision.reason,
  };
}

export function isOutreachWindowHold(
  result: { heldForSendWindow?: boolean; error?: string | null } | null | undefined
): boolean {
  return (
    result?.heldForSendWindow === true ||
    (typeof result?.error === "string" && result.error.startsWith("Held for America/Boise weekday business hours"))
  );
}
