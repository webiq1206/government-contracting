/**
 * When a subcontractor's quote is actually needed, which is never the day the
 * government bid is due.
 *
 * The outreach email used to tell subcontractors "our bid is due {{deadline}},
 * please reply before then". That is the wrong date to give them, and giving
 * it out is how a quote lands at 4pm on submission day. Between receiving a
 * price and submitting a package, Brost Co still has to read the quote, ask
 * about anything odd, find replacement coverage if the number is unusable,
 * apply markup and contingency, assemble the package, check it, and submit --
 * and none of that can happen after the deadline the subcontractor was given.
 *
 * So the quote date is its own thing: strictly earlier than the government
 * deadline, by enough working time to absorb one bad quote. It is expressed in
 * the sender's timezone with the zone spelled out, because "3:00 PM" between
 * two firms in different states is not a time.
 *
 * Pure: takes a deadline and a clock, returns a date and its reasoning. No
 * database, no I/O.
 */

/** Working days we want between the quote landing and the bid going out. */
const TARGET_LEAD_BUSINESS_DAYS = 5;

/** Below this, a quote cannot be reviewed and packaged at all. */
const MIN_LEAD_MS = 12 * 3_600_000;

/** Never ask for a quote sooner than this; subs need time to price. */
const MIN_SUB_WORKING_MS = 24 * 3_600_000;

/** Hour of the sender's day the quote is due. Late enough to be a full day. */
const DUE_HOUR_LOCAL = 15;

/**
 * State to IANA zone. Coarse on purpose: states split across zones resolve to
 * the one holding most of the population, because the alternative is asking an
 * operator to pick a timezone per opportunity to save an hour of slack on a
 * deadline that already carries days of it.
 */
const STATE_TIMEZONES: Record<string, string> = {
  AL: "America/Chicago", AK: "America/Anchorage", AZ: "America/Phoenix",
  AR: "America/Chicago", CA: "America/Los_Angeles", CO: "America/Denver",
  CT: "America/New_York", DE: "America/New_York", DC: "America/New_York",
  FL: "America/New_York", GA: "America/New_York", HI: "Pacific/Honolulu",
  ID: "America/Boise", IL: "America/Chicago", IN: "America/Indiana/Indianapolis",
  IA: "America/Chicago", KS: "America/Chicago", KY: "America/New_York",
  LA: "America/Chicago", ME: "America/New_York", MD: "America/New_York",
  MA: "America/New_York", MI: "America/Detroit", MN: "America/Chicago",
  MS: "America/Chicago", MO: "America/Chicago", MT: "America/Denver",
  NE: "America/Chicago", NV: "America/Los_Angeles", NH: "America/New_York",
  NJ: "America/New_York", NM: "America/Denver", NY: "America/New_York",
  NC: "America/New_York", ND: "America/Chicago", OH: "America/New_York",
  OK: "America/Chicago", OR: "America/Los_Angeles", PA: "America/New_York",
  RI: "America/New_York", SC: "America/New_York", SD: "America/Chicago",
  TN: "America/Chicago", TX: "America/Chicago", UT: "America/Denver",
  VT: "America/New_York", VA: "America/New_York", WA: "America/Los_Angeles",
  WV: "America/New_York", WI: "America/Chicago", WY: "America/Denver",
  PR: "America/Puerto_Rico", VI: "America/Puerto_Rico", GU: "Pacific/Guam",
};

export type QuoteDeadlineBasis =
  /** The full working lead we want. */
  | "target"
  /** Compressed: the bid is close, so the sub gets what is left, minus ours. */
  | "compressed"
  /** No honest date exists; the bid is too close to source anything. */
  | "impossible"
  /** No government deadline to work back from. */
  | "no_deadline";

export interface QuoteDeadline {
  /** ISO instant the quote is due, or null when none can be promised. */
  at: string | null;
  /** "August 22, 2026 at 3:00 PM MDT". Empty when `at` is null. */
  label: string;
  /** IANA zone the label is expressed in. */
  timeZone: string;
  basis: QuoteDeadlineBasis;
  /** Set when an operator needs to know the date was squeezed or refused. */
  warning: string | null;
}

/** The zone a date should be spoken in: the sender's, then the job's. */
export function resolveTimeZone(input: {
  senderState?: string | null;
  projectState?: string | null;
}): { timeZone: string; derivedFrom: "sender" | "project" | "fallback" } {
  const sender = STATE_TIMEZONES[(input.senderState ?? "").trim().toUpperCase()];
  if (sender) return { timeZone: sender, derivedFrom: "sender" };
  const project = STATE_TIMEZONES[(input.projectState ?? "").trim().toUpperCase()];
  if (project) return { timeZone: project, derivedFrom: "project" };
  /*
   * Eastern, and said out loud in the label. A quote deadline with no zone is
   * ambiguous by three hours; one carrying the wrong zone is at least a
   * checkable claim, and the label always names it.
   */
  return { timeZone: "America/New_York", derivedFrom: "fallback" };
}

/** "August 22, 2026 at 3:00 PM MDT" */
export function formatQuoteDueLabel(at: Date, timeZone: string): string {
  const date = at.toLocaleDateString("en-US", {
    timeZone,
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const time = at.toLocaleTimeString("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return `${date} at ${time}`;
}

/** Step back whole days, skipping Saturday and Sunday, in the given zone. */
function subtractBusinessDays(from: Date, days: number, timeZone: string): Date {
  let cursor = new Date(from.getTime());
  let left = days;
  while (left > 0) {
    cursor = new Date(cursor.getTime() - 86_400_000);
    const weekday = cursor.toLocaleDateString("en-US", { timeZone, weekday: "short" });
    if (weekday !== "Sat" && weekday !== "Sun") left -= 1;
  }
  return cursor;
}

/**
 * Move an instant to a given local hour in a zone, on the same local day.
 *
 * Done by measuring the offset rather than by constructing a local date: the
 * zone's UTC offset changes twice a year, and a date built from parts is
 * silently wrong on those two days.
 */
function atLocalHour(instant: Date, hour: number, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  // "24" is midnight in some locales' hour12:false output.
  const currentHour = get("hour") % 24;
  const deltaMs =
    (hour - currentHour) * 3_600_000 - get("minute") * 60_000 - get("second") * 1000;
  return new Date(instant.getTime() + deltaMs);
}

/**
 * The date to put in front of a subcontractor, worked back from ours.
 *
 * The one invariant worth stating plainly: the returned instant is ALWAYS
 * strictly before the government deadline, or it is null. There is no input
 * that produces a quote date on or after the bid date, because that email
 * would be asking a subcontractor to be late.
 */
export function computeQuoteDeadline(input: {
  /** The government / prime bid deadline. */
  deadline: string | Date | null;
  timeZone: string;
  /** Injected so tests do not depend on today. */
  now?: Date;
}): QuoteDeadline {
  const { timeZone } = input;
  const now = input.now ?? new Date();

  if (!input.deadline) {
    return {
      at: null,
      label: "",
      timeZone,
      basis: "no_deadline",
      warning:
        "No bid deadline on this opportunity, so there is no date to work back from and no quote deadline to give anyone.",
    };
  }
  const deadline =
    input.deadline instanceof Date ? input.deadline : new Date(input.deadline);
  if (Number.isNaN(deadline.getTime())) {
    return {
      at: null,
      label: "",
      timeZone,
      basis: "no_deadline",
      warning: "The bid deadline on this opportunity is not a readable date.",
    };
  }

  const room = deadline.getTime() - now.getTime();
  if (room < MIN_SUB_WORKING_MS + MIN_LEAD_MS) {
    /*
     * Under about a day and a half there is no split of the remaining time
     * that gives the sub long enough to price AND leaves us long enough to
     * package. Saying so beats inventing a deadline nobody can meet.
     */
    return {
      at: null,
      label: "",
      timeZone,
      basis: "impossible",
      warning:
        "The bid is too close to ask for a quote: there is not enough time left for a subcontractor to price the work and for us to review and package it.",
    };
  }

  const target = atLocalHour(
    subtractBusinessDays(deadline, TARGET_LEAD_BUSINESS_DAYS, timeZone),
    DUE_HOUR_LOCAL,
    timeZone
  );

  const earliestWeCanAsk = now.getTime() + MIN_SUB_WORKING_MS;
  const latestUseful = deadline.getTime() - MIN_LEAD_MS;

  if (target.getTime() >= earliestWeCanAsk && target.getTime() <= latestUseful) {
    return {
      at: target.toISOString(),
      label: formatQuoteDueLabel(target, timeZone),
      timeZone,
      basis: "target",
      warning: null,
    };
  }

  /*
   * Not enough runway for the full lead, but enough for some. Split what is
   * left: the sub gets the larger share (they have to do the actual pricing),
   * we keep the rest. Clamped so neither side drops below its floor.
   */
  const midpoint = now.getTime() + room * 0.6;
  const squeezed = new Date(
    Math.min(Math.max(midpoint, earliestWeCanAsk), latestUseful)
  );
  const onTheHour = atLocalHour(squeezed, DUE_HOUR_LOCAL, timeZone);
  // Snapping to 3pm can push past either edge; only keep it if it still fits.
  const at =
    onTheHour.getTime() >= earliestWeCanAsk && onTheHour.getTime() <= latestUseful
      ? onTheHour
      : squeezed;

  return {
    at: at.toISOString(),
    label: formatQuoteDueLabel(at, timeZone),
    timeZone,
    basis: "compressed",
    warning:
      "The bid deadline is close, so the quote deadline is tighter than usual. There is little room to chase a replacement if this quote does not work.",
  };
}
