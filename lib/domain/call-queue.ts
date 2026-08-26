/**
 * Working a call queue: which call to make, whether it is a reasonable hour
 * where they are, and what to say you are calling about.
 *
 * The queue was a list of cards ordered by deadline. That answers "who is
 * left" and misses three things a person needs before dialling: whether it is
 * the middle of the night at the other end, whether the number is any good,
 * and why this call is happening at all. The third is the one operators
 * reconstruct from memory every time, and get wrong on the tenth call of the
 * morning.
 *
 * Pure.
 */

export interface CallCardFacts {
  id: string;
  companyName: string;
  trade: string | null;
  opportunityId: string | null;
  opportunityTitle: string | null;
  deadline: string | null;
  /** "reply" when the sub wrote back, otherwise the queue's own sourcing. */
  source: string | null;
  phone: string | null;
  email: string | null;
  emailVerified: boolean;
  /** Two-letter state, used only to work out the hour where they are. */
  state: string | null;
  lastContacted: string | null;
  /** Times this card has been dialled and nobody answered. */
  attempts: number;
}

// ---------------------------------------------------------------------------
// The hour where they are
// ---------------------------------------------------------------------------

/**
 * State to IANA zone.
 *
 * Deliberately incomplete and honest about it. The states split across two
 * zones -- Florida, Texas, the Dakotas, Kansas, Nebraska, Indiana, Kentucky,
 * Tennessee, Michigan, Oregon, Idaho -- are left out entirely rather than
 * guessed at, because a confident wrong local time is worse than none: it is
 * the difference between an operator checking and an operator dialling
 * somebody at six in the morning.
 */
const STATE_ZONE: Record<string, string> = {
  AL: "America/Chicago", AK: "America/Anchorage", AZ: "America/Phoenix",
  AR: "America/Chicago", CA: "America/Los_Angeles", CO: "America/Denver",
  CT: "America/New_York", DE: "America/New_York", DC: "America/New_York",
  GA: "America/New_York", HI: "Pacific/Honolulu", IL: "America/Chicago",
  IA: "America/Chicago", LA: "America/Chicago", ME: "America/New_York",
  MD: "America/New_York", MA: "America/New_York", MN: "America/Chicago",
  MS: "America/Chicago", MO: "America/Chicago", MT: "America/Denver",
  NV: "America/Los_Angeles", NH: "America/New_York", NJ: "America/New_York",
  NM: "America/Denver", NY: "America/New_York", NC: "America/New_York",
  OH: "America/New_York", OK: "America/Chicago", PA: "America/New_York",
  RI: "America/New_York", SC: "America/New_York", UT: "America/Denver",
  VT: "America/New_York", VA: "America/New_York", WA: "America/Los_Angeles",
  WV: "America/New_York", WI: "America/Chicago", WY: "America/Denver",
};

export interface LocalTime {
  /** "9:14 AM", or null when the state does not pin a single zone. */
  label: string | null;
  /** True when it is inside the configured calling window where they are. */
  reasonableHour: boolean | null;
  /** The hour there, 0 to 23, or null when the zone is not known. */
  hour: number | null;
  /** Why there is no time, when there is none. */
  note: string | null;
}

/** The window this module assumes when no rules are supplied. */
export const DEFAULT_CALL_HOURS = { start: 8, end: 18 };

export function localTimeFor(
  state: string | null | undefined,
  now = new Date(),
  /**
   * The operator's calling window, in the recipient's local time. Defaulted
   * rather than required so every existing caller keeps its behaviour, and
   * passed explicitly by the call queue, which knows the rules.
   */
  hours: { start: number; end: number } = DEFAULT_CALL_HOURS
): LocalTime {
  const zone = STATE_ZONE[(state ?? "").trim().toUpperCase()];
  if (!zone) {
    return {
      label: null,
      reasonableHour: null,
      hour: null,
      note: state
        ? "That state spans more than one time zone, so the hour there is not certain."
        : "No location on file, so the hour there is unknown.",
    };
  }
  try {
    const label = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: "numeric",
      minute: "2-digit",
    }).format(now);
    const hour = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", hour12: false }).format(now)
    );
    return {
      label,
      reasonableHour: hour >= hours.start && hour < hours.end,
      hour,
      note: null,
    };
  } catch {
    return {
      label: null,
      reasonableHour: null,
      hour: null,
      note: "Could not work out the hour there.",
    };
  }
}

// ---------------------------------------------------------------------------
// Whether this card may be called at all
// ---------------------------------------------------------------------------

export type CallableState = "callable" | "outside_hours" | "attempts_spent" | "hour_unknown";

export interface Callability {
  state: CallableState;
  /** True only for `callable`: everything else is a reason to leave it alone. */
  callable: boolean;
  /** What to tell the operator, in their words. */
  reason: string;
}

export interface CallRules {
  /** Earliest hour, in the recipient's local time. */
  call_hours_start: number;
  /** Latest hour, exclusive, in the recipient's local time. */
  call_hours_end: number;
  /** Unanswered attempts before the card stops being offered. 0 = no limit. */
  call_max_attempts: number;
}

/**
 * Whether the queue should be handing this card to somebody right now.
 *
 * Both rules here were previously observations rather than rules. The local
 * hour was computed and displayed, so the queue would cheerfully put a card at
 * the top of the list at five in the morning where that firm is; and attempts
 * were counted and displayed, so a number that had rung out eleven times came
 * back every day forever. Neither is a hard block: the card stays visible and
 * says why, because hiding work is how an operator stops trusting the queue.
 */
export function callability(
  c: Pick<CallCardFacts, "state" | "attempts">,
  rules: CallRules,
  now = new Date()
): Callability {
  if (rules.call_max_attempts > 0 && c.attempts >= rules.call_max_attempts) {
    return {
      state: "attempts_spent",
      callable: false,
      reason: `Called ${c.attempts} times with no answer, which is the limit you set. Try a different contact at this firm, or raise the limit in Automation Rules.`,
    };
  }
  const local = localTimeFor(c.state, now, {
    start: rules.call_hours_start,
    end: rules.call_hours_end,
  });
  if (local.reasonableHour === false) {
    return {
      state: "outside_hours",
      callable: false,
      reason: `It is ${local.label} where they are, outside the ${formatHour(rules.call_hours_start)} to ${formatHour(rules.call_hours_end)} window you set.`,
    };
  }
  if (local.reasonableHour === null) {
    return {
      state: "hour_unknown",
      callable: true,
      reason: local.note ?? "The hour there is unknown, so check before dialling.",
    };
  }
  return {
    state: "callable",
    callable: true,
    reason: `${local.label} where they are, inside your calling hours.`,
  };
}

/** "8" reads as 8:00 AM, "17" as 5:00 PM. Nobody sets calling hours in 24-hour time. */
export function formatHour(h: number): string {
  const hour = ((Math.round(h) % 24) + 24) % 24;
  const suffix = hour < 12 ? "am" : "pm";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}${suffix}`;
}

// ---------------------------------------------------------------------------
// Whether the number is any good, and why we are calling
// ---------------------------------------------------------------------------

export type ContactQuality = "phone_verified_email" | "phone_only" | "no_phone";

export const CONTACT_QUALITY_LABEL: Record<ContactQuality, string> = {
  phone_verified_email: "Phone and a confirmed email",
  phone_only: "Phone only",
  no_phone: "No phone number",
};

export function contactQuality(c: CallCardFacts): ContactQuality {
  if (!c.phone) return "no_phone";
  return c.email && c.emailVerified ? "phone_verified_email" : "phone_only";
}

/**
 * Why this call is happening, in one line.
 *
 * Ordered by what a person would lead the call with. A subcontractor who
 * already wrote back is a different conversation from one who has ignored two
 * emails, and opening both with the same sentence wastes the first and
 * annoys the second.
 */
export function callReason(c: CallCardFacts, now = new Date()): string {
  if (c.source === "reply") {
    return "They wrote back. This call is to turn their answer into a number.";
  }
  if (c.attempts > 0) {
    return `Called ${c.attempts} time${c.attempts === 1 ? "" : "s"} already with no answer. Try a different hour, or a different contact.`;
  }
  if (!c.lastContacted) {
    return "Emailed, nothing back, and no call has been made yet.";
  }
  const days = Math.floor((now.getTime() - new Date(c.lastContacted).getTime()) / 86_400_000);
  if (Number.isNaN(days)) {
    return "Emailed, nothing back. A call is the next step.";
  }
  return `Emailed ${days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`}, nothing back. A call is the next step.`;
}

// ---------------------------------------------------------------------------
// The header
// ---------------------------------------------------------------------------

export interface CallQueueCounts {
  remaining: number;
  /** Calls whose opportunity deadline has passed or is inside two days. */
  urgent: number;
  /** Calls where it is outside the calling window at the other end right now. */
  badHour: number;
  /** Calls with no phone number, which cannot be made at all. */
  unreachable: number;
  /** Calls that have used up the attempt limit and are no longer worth dialling. */
  attemptsSpent: number;
}

export function callQueueCounts(
  cards: CallCardFacts[],
  now = new Date(),
  /** The operator's rules, so the header counts the same window the rows use. */
  rules: CallRules = {
    call_hours_start: DEFAULT_CALL_HOURS.start,
    call_hours_end: DEFAULT_CALL_HOURS.end,
    call_max_attempts: 0,
  }
): CallQueueCounts {
  let urgent = 0;
  let badHour = 0;
  let unreachable = 0;
  let attemptsSpent = 0;
  for (const c of cards) {
    if (c.deadline) {
      const days = (new Date(c.deadline).getTime() - now.getTime()) / 86_400_000;
      if (!Number.isNaN(days) && days < 2) urgent += 1;
    }
    const call = callability(c, rules, now);
    if (call.state === "outside_hours") badHour += 1;
    if (call.state === "attempts_spent") attemptsSpent += 1;
    if (!c.phone) unreachable += 1;
  }
  return { remaining: cards.length, urgent, badHour, unreachable, attemptsSpent };
}

// ---------------------------------------------------------------------------
// Grouping, sorting and filtering
// ---------------------------------------------------------------------------

export const CALL_GROUPINGS = ["none", "opportunity", "trade"] as const;
export type CallGrouping = (typeof CALL_GROUPINGS)[number];

export const CALL_GROUPING_LABEL: Record<CallGrouping, string> = {
  none: "Deadline order",
  opportunity: "By opportunity",
  trade: "By trade",
};

export function parseCallGrouping(raw: string | string[] | undefined): CallGrouping {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (CALL_GROUPINGS as readonly string[]).includes(v ?? "") ? (v as CallGrouping) : "none";
}

export interface CallGroup<T> {
  key: string;
  label: string;
  cards: T[];
}

/**
 * Group the queue, keeping the incoming order inside each group.
 *
 * Order matters more than the grouping: the queue arrives soonest-deadline
 * first with replies on top, and regrouping must not quietly resort it.
 */
export function groupCalls<T extends CallCardFacts>(
  cards: T[],
  by: CallGrouping
): CallGroup<T>[] {
  if (by === "none") {
    return [{ key: "all", label: "", cards }];
  }
  const groups = new Map<string, CallGroup<T>>();
  for (const c of cards) {
    const key =
      by === "opportunity"
        ? c.opportunityId ?? "none"
        : (c.trade ?? "").trim().toLowerCase() || "none";
    const label =
      by === "opportunity"
        ? c.opportunityTitle ?? "Not filed against a solicitation"
        : c.trade ?? "No trade recorded";
    if (!groups.has(key)) groups.set(key, { key, label, cards: [] });
    groups.get(key)!.cards.push(c);
  }
  return [...groups.values()];
}

/** Text match across the company, trade and solicitation. */
export function filterCalls<T extends CallCardFacts>(cards: T[], q: string): T[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return cards;
  return cards.filter((c) =>
    `${c.companyName} ${c.trade ?? ""} ${c.opportunityTitle ?? ""}`.toLowerCase().includes(needle)
  );
}
