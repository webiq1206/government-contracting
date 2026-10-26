/**
 * Outreach send window for one already-resolved IANA zone.
 *
 * The zone is chosen before this module runs: a solid recipient state/city,
 * else the sending account's organizations.timezone, else America/Boise.
 * The worker, the scheduler, and Node's process timezone are the wrong clock.
 * A cron that fires all night uses the host zone. Reading the host's local
 * hour would open the gate on that clock. Quote requests, follow-ups,
 * sources-sought sends, and backlink outreach may leave only during weekday
 * business hours in the zone that resolution produced.
 *
 * The zone is passed into Intl as `timeZone`. It is not read from
 * Date#getHours, Date#getDay, the process TZ, or the recap default
 * America/Denver. An omitted or unusable zone falls back to America/Boise.
 * Mountain Time still changes: after the fall-back, 15:00 UTC is 8:00 in
 * Boise, not 9:00. Intl applies that shift. A fixed offset would not.
 *
 * Monday–Friday, 9:00 AM inclusive through 4:59 PM. 5:00 PM is closed.
 * Weekends are closed.
 */

/** Used when neither the recipient nor organizations.timezone names a real IANA zone. */
export const OUTREACH_SEND_FALLBACK_TIME_ZONE = "America/Boise" as const;
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

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * The zone a send must use.
 *
 * A recognised IANA name is returned in the form Intl resolved. Null, blank,
 * and any name Intl rejects become America/Boise. This is not the recap
 * helper: an unusable recap zone falls back to America/Denver, and outreach
 * must not follow that default.
 */
export function resolveOutreachSendTimeZone(stored: string | null | undefined): string {
  const tz = (stored ?? "").trim();
  if (!tz) return OUTREACH_SEND_FALLBACK_TIME_ZONE;
  try {
    const canonical = new Intl.DateTimeFormat("en-US", { timeZone: tz }).resolvedOptions().timeZone;
    return canonical || OUTREACH_SEND_FALLBACK_TIME_ZONE;
  } catch {
    return OUTREACH_SEND_FALLBACK_TIME_ZONE;
  }
}

/** True when Intl accepts this name. Blank is not a zone. */
export function isRecognizedTimeZone(stored: string | null | undefined): boolean {
  const tz = (stored ?? "").trim();
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The zone Intl actually resolved for this stored value. Tests use this to prove the pin. */
export function outreachSendTimeZone(stored?: string | null): string {
  const zone = resolveOutreachSendTimeZone(stored);
  return formatterFor(zone).resolvedOptions().timeZone;
}

export interface OutreachLocalParts {
  /** 0 Sunday through 6 Saturday, on that zone's calendar date. */
  weekday: number;
  hour: number;
  minute: number;
  year: number;
  month: number;
  day: number;
  timeZone: string;
}

export interface OutreachSendWindowDecision extends OutreachLocalParts {
  open: boolean;
  reason: string;
}

export interface OutreachWindowRefusal {
  disabled: true;
  retryable: true;
  outcome: "not_attempted";
  heldForSendWindow: true;
  error: string;
}

/** Wall clock in the account zone. Never the process zone. */
export function outreachLocalParts(at: Date, stored?: string | null): OutreachLocalParts {
  const timeZone = resolveOutreachSendTimeZone(stored);
  const parts = formatterFor(timeZone).formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const weekday = WEEKDAY_INDEX[read("weekday")];
  if (weekday == null) {
    throw new Error(
      `${timeZone} weekday could not be read from ${read("weekday") || "an empty value"}.`
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
    timeZone,
  };
}

export function outreachWindowReason(timeZone: string): string {
  return `Held for ${timeZone} weekday business hours (Monday-Friday, 9:00 AM-5:00 PM local). Nothing was sent. The next in-window run will send it.`;
}

/**
 * Monday–Friday, hour >= 9 and hour < 17, in the account zone.
 * 9:00 AM is open. 5:00 PM is closed. An omitted zone uses America/Boise.
 */
export function evaluateOutreachSendWindow(
  at: Date = new Date(),
  stored?: string | null
): OutreachSendWindowDecision {
  const local = outreachLocalParts(at, stored);
  const open =
    local.weekday >= 1 &&
    local.weekday <= 5 &&
    local.hour >= OUTREACH_SEND_OPEN_HOUR &&
    local.hour < OUTREACH_SEND_CLOSE_HOUR;
  return {
    ...local,
    open,
    reason: open
      ? `Within ${local.timeZone} weekday business hours.`
      : outreachWindowReason(local.timeZone),
  };
}

/**
 * Refusal for a provider send outside the account's window.
 * Retryable and not a permanent failure: the next in-window run sends it.
 * Null while the window is open.
 */
export function outreachWindowRefusal(
  at: Date = new Date(),
  stored?: string | null
): OutreachWindowRefusal | null {
  const decision = evaluateOutreachSendWindow(at, stored);
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
    (typeof result?.error === "string" &&
      result.error.startsWith("Held for ") &&
      result.error.includes("weekday business hours"))
  );
}
