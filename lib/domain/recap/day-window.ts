/**
 * What "yesterday" means to the person reading the mail.
 *
 * A daily recap is the one feature in this product where the server's clock is
 * the wrong clock. The scheduler ticks in whatever zone the worker happens to
 * run in; the recap has to describe a day that started and ended where the
 * reader was standing, and arrive at six in the morning there. Get this wrong
 * and the totals are quietly for the wrong twenty-four hours, which is worse
 * than being late, because nothing about the mail says so.
 *
 * Everything here is pure and uses only Intl, which carries the zone database
 * Node ships with. No dependency, and no home-grown offset table that goes
 * stale the next time a country moves its clocks.
 *
 * Daylight saving is handled explicitly rather than hoped over:
 *   - the morning a zone springs forward, 02:30 does not exist, so a send
 *     scheduled then goes at the first instant that does exist
 *   - the morning it falls back, 01:30 happens twice, and the send goes at the
 *     first one, because the second is an hour late for no reason
 *   - a day is 23, 24 or 25 hours long, and the window is always
 *     [local midnight, next local midnight), never "start plus 24 hours"
 */

/** The account default when nobody has chosen: Mountain Time. */
export const DEFAULT_TIMEZONE = "America/Denver";

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
}

/**
 * Whether Intl recognises this zone name.
 *
 * A stored zone can go bad: a hand-edited row, a name a browser offered that
 * this Node build does not carry. Every read path validates rather than
 * throwing deep inside a formatter, because the failure mode we want is "this
 * person gets the default", not "the morning send crashes for everybody".
 */
export function isValidTimeZone(tz: string | null | undefined): boolean {
  if (!tz || typeof tz !== "string" || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz.trim() }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** The stored zone if it is usable, otherwise the account default. */
export function safeTimeZone(tz: string | null | undefined): string {
  return isValidTimeZone(tz) ? (tz as string).trim() : DEFAULT_TIMEZONE;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

/** The wall clock in `tz` at this instant. */
export function zonedParts(instant: Date, tz: string): ZonedParts {
  const zone = safeTimeZone(tz);
  const parts = formatterFor(zone).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  // Some ICU builds render midnight as hour 24 under hour12:false.
  const hour = get("hour") % 24;
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
    minute: get("minute"),
    second: get("second"),
  };
}

/** How far ahead of UTC `tz` is at this instant, in milliseconds. */
function offsetMs(instant: Date, tz: string): number {
  const p = zonedParts(instant, tz);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Second precision is all the formatter gives; keep the sub-second part of
  // the instant out of the difference.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** "YYYY-MM-DD" for the local day this instant falls in. */
export function localDateOf(instant: Date, tz: string): string {
  const p = zonedParts(instant, tz);
  return `${p.year.toString().padStart(4, "0")}-${p.month
    .toString()
    .padStart(2, "0")}-${p.day.toString().padStart(2, "0")}`;
}

/** Parse "YYYY-MM-DD" into its three numbers, or null if it is not one. */
export function parseLocalDate(
  localDate: string
): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((localDate ?? "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/**
 * The instant at which a given wall-clock time occurs in `tz`.
 *
 * The offset depends on the answer, so this works from candidates rather than
 * from a single guess: read the offset at the naive instant, use it to land
 * somewhere near, read the offset there too, and try the requested wall time
 * against both. Then check each candidate by formatting it back into the zone,
 * which is the only test that distinguishes the three cases.
 *
 *   - Ordinary day: one candidate reads back as the requested wall time.
 *   - Fall back: 01:30 happens twice and both candidates read back. The
 *     earlier one wins, because the later one is an hour late for no reason.
 *   - Spring forward: 02:30 does not exist, so neither candidate reads back.
 *     The later one wins, which is the wall time shifted forward by the gap
 *     (a 02:30 send goes at 03:30, the first moment that day reaches it).
 *
 * The naive version of this, taking whatever the second pass produced, sent an
 * hour EARLY on spring-forward mornings: the passes oscillate across the gap
 * and it settled on 01:30, before the missing hour rather than after it.
 */
export function zonedTimeToInstant(
  localDate: string,
  hour: number,
  minute: number,
  tz: string
): Date {
  const zone = safeTimeZone(tz);
  const parsed = parseLocalDate(localDate);
  if (!parsed) throw new Error(`Not a local date: ${localDate}`);
  const naive = Date.UTC(parsed.year, parsed.month - 1, parsed.day, hour, minute, 0);

  const first = offsetMs(new Date(naive), zone);
  const second = offsetMs(new Date(naive - first), zone);
  const candidates = [...new Set([naive - first, naive - second])];

  const lands = (ts: number) => {
    const p = zonedParts(new Date(ts), zone);
    return (
      p.year === parsed.year &&
      p.month === parsed.month &&
      p.day === parsed.day &&
      p.hour === hour &&
      p.minute === minute
    );
  };

  const real = candidates.filter(lands);
  return new Date(real.length > 0 ? Math.min(...real) : Math.max(...candidates));
}

export interface DayWindow {
  /** "YYYY-MM-DD" in the recipient's zone. */
  localDate: string;
  timezone: string;
  /** Inclusive start: local midnight. */
  start: Date;
  /** Exclusive end: the next local midnight. 23, 24 or 25 hours later. */
  end: Date;
}

/** The half-open window covering one local calendar day. */
export function dayWindow(localDate: string, tz: string): DayWindow {
  const zone = safeTimeZone(tz);
  const start = zonedTimeToInstant(localDate, 0, 0, zone);
  const next = addLocalDays(localDate, 1);
  const end = zonedTimeToInstant(next, 0, 0, zone);
  return { localDate, timezone: zone, start, end };
}

/** Calendar arithmetic on the date string itself, so no zone is involved. */
export function addLocalDays(localDate: string, days: number): string {
  const parsed = parseLocalDate(localDate);
  if (!parsed) throw new Error(`Not a local date: ${localDate}`);
  const d = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`, both "YYYY-MM-DD". Negative if `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const a = parseLocalDate(from);
  const b = parseLocalDate(to);
  if (!a || !b) return 0;
  const ms =
    Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day);
  return Math.round(ms / 86_400_000);
}

/** Yesterday, in the recipient's zone, as of `now`. */
export function previousLocalDate(now: Date, tz: string): string {
  return addLocalDays(localDateOf(now, tz), -1);
}

/**
 * "06:00" as hour and minute, clamped to something real.
 *
 * A stored delivery time comes from a form, and the failure mode of a bad one
 * must not be a send at a random hour. Anything unparseable reads as 06:00,
 * which is the default the setting was created with.
 */
export function parseSendAt(value: string | null | undefined): { hour: number; minute: number } {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(value ?? "");
  if (!m) return { hour: 6, minute: 0 };
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return { hour: 6, minute: 0 };
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return { hour: 6, minute: 0 };
  return { hour, minute };
}

/** "06:00" from hour and minute, for storing and displaying. */
export function formatSendAt(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * "06:00" as "6:00 AM", for prose rather than a form field.
 *
 * No zone in the label on purpose: this time is read in the recipient's own
 * zone, and naming one would be wrong for everybody else on the account.
 */
export function sendAtLabel(value: string | null | undefined): string {
  const { hour, minute } = parseSendAt(value);
  const suffix = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export interface DueDecision {
  /** Send now. */
  due: boolean;
  /** The local day this send is for: the day being summarised is the one before. */
  localDate: string;
  /** When the send was supposed to go out. */
  dueAt: Date;
  /** It is past the scheduled window and the mail should say so. */
  late: boolean;
  /** Why not, when `due` is false. For the log line and the tests. */
  reason: "before-window" | "past-cutoff" | "due" ;
}

/**
 * Whether this recipient's recap is due right now.
 *
 * The scheduler cannot promise to tick at exactly the scheduled minute, and a
 * worker that was asleep or restarting may come back hours later. So this is a
 * window, not an instant: due from the scheduled time until a cutoff, and
 * marked late once the grace period has passed.
 *
 * `lateAfterMinutes` is the grace period, beyond which the mail says it is
 * late. `cutoffHours` is the point at which a missed morning stops being worth
 * sending: past it, the day rolls on and the next morning's recap covers it.
 */
export function recapDue(input: {
  now: Date;
  timezone: string;
  sendAt: string;
  lateAfterMinutes?: number;
  cutoffHours?: number;
}): DueDecision {
  const tz = safeTimeZone(input.timezone);
  const { hour, minute } = parseSendAt(input.sendAt);
  const localDate = localDateOf(input.now, tz);
  const dueAt = zonedTimeToInstant(localDate, hour, minute, tz);
  const lateAfterMinutes = input.lateAfterMinutes ?? 45;
  const cutoffHours = input.cutoffHours ?? 12;

  const elapsedMs = input.now.getTime() - dueAt.getTime();
  if (elapsedMs < 0) {
    return { due: false, localDate, dueAt, late: false, reason: "before-window" };
  }
  if (elapsedMs > cutoffHours * 3_600_000) {
    return { due: false, localDate, dueAt, late: true, reason: "past-cutoff" };
  }
  return {
    due: true,
    localDate,
    dueAt,
    late: elapsedMs > lateAfterMinutes * 60_000,
    reason: "due",
  };
}

/** A readable clock time in the recipient's zone, e.g. "6:04 AM". */
export function localTimeLabel(instant: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: safeTimeZone(tz),
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(instant);
  } catch {
    return instant.toISOString();
  }
}

/** A readable day in the recipient's zone, e.g. "Saturday, August 29". */
export function localDayLabel(localDate: string, tz: string): string {
  const parsed = parseLocalDate(localDate);
  if (!parsed) return localDate;
  // Noon UTC-shifted into the zone: any hour inside the day formats the same
  // day name, and noon is far enough from both boundaries to be safe anywhere.
  const at = zonedTimeToInstant(localDate, 12, 0, safeTimeZone(tz));
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: safeTimeZone(tz),
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(at);
  } catch {
    return localDate;
  }
}

/**
 * The zones offered in the picker.
 *
 * Deliberately short and US-first: this is a federal-contracting product and
 * every account so far is in the continental United States, Alaska or Hawaii.
 * A full IANA list is six hundred entries, most of which would be a wrong
 * answer chosen by accident. A stored zone outside this list still works
 * everywhere else in the code; the list only governs what the form offers.
 */
export const TIMEZONE_CHOICES: { value: string; label: string }[] = [
  { value: "America/New_York", label: "Eastern (New York)" },
  { value: "America/Chicago", label: "Central (Chicago)" },
  { value: "America/Denver", label: "Mountain (Denver, Boise)" },
  { value: "America/Phoenix", label: "Arizona (no daylight saving)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "America/Anchorage", label: "Alaska (Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii (Honolulu)" },
  { value: "America/Puerto_Rico", label: "Atlantic (Puerto Rico)" },
  { value: "UTC", label: "UTC" },
];
