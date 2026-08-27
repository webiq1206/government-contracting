/**
 * A month of compliance dates, laid out as a grid.
 *
 * The board had a ninety-day strip, which answers "which of these lands
 * first". It does not answer "what does March look like", and that is the
 * question somebody asks when they are deciding which week to take off or
 * whether three renewals have stacked on the same Friday.
 *
 * Pure, and timezone-explicit: a renewal deadline is a wall-clock date
 * somewhere, and building a grid out of the server's local midnight puts an
 * item in the wrong square for anybody more than a few hours away.
 */

export interface CalendarItem {
  id: string;
  label: string;
  /** The date it falls due, as an ISO string. */
  dueAt: string;
  /** Already resolved by the caller, so the grid does not re-derive it. */
  state: string;
  tone: "green" | "amber" | "red" | "slate";
  href?: string;
}

export interface CalendarDay {
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  dayOfMonth: number;
  /** False for the leading and trailing days that pad the grid. */
  inMonth: boolean;
  isToday: boolean;
  items: CalendarItem[];
}

export interface CalendarMonth {
  /** `YYYY-MM`, the month this grid is for. */
  month: string;
  label: string;
  /** Six rows of seven, always, so the grid does not change height. */
  weeks: CalendarDay[][];
  /** Items in this month, in date order, for the list beneath the grid. */
  listed: CalendarItem[];
  /** Items with no date at all, which no square can hold. */
  undated: CalendarItem[];
  prevMonth: string;
  nextMonth: string;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** `YYYY-MM-DD` for an instant, in the given timezone. */
export function dayKey(at: string | Date, timeZone?: string | null): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  if (!timeZone) return d.toISOString().slice(0, 10);
  try {
    // en-CA gives YYYY-MM-DD, which is the shape the grid keys on.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    /*
     * An unknown timezone falls back to UTC rather than throwing. A bad value
     * in one row must not take out the whole calendar, and the item still
     * lands within a day of where it belongs.
     */
    return d.toISOString().slice(0, 10);
  }
}

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Build the grid.
 *
 * `month` is `YYYY-MM`. Weeks start on Sunday, which is what a US federal
 * contracting calendar is read against.
 */
export function buildCalendar(input: {
  month: string;
  items: CalendarItem[];
  today?: string;
  timeZone?: string | null;
}): CalendarMonth {
  const [year, monthNum] = input.month.split("-").map(Number);
  const valid = Number.isFinite(year) && Number.isFinite(monthNum) && monthNum >= 1 && monthNum <= 12;
  const y = valid ? year : new Date().getUTCFullYear();
  const m = valid ? monthNum : new Date().getUTCMonth() + 1;
  const month = `${y}-${String(m).padStart(2, "0")}`;

  const byDay = new Map<string, CalendarItem[]>();
  const undated: CalendarItem[] = [];
  for (const item of input.items) {
    const key = item.dueAt ? dayKey(item.dueAt, input.timeZone) : "";
    if (!key) {
      undated.push(item);
      continue;
    }
    const list = byDay.get(key) ?? [];
    list.push(item);
    byDay.set(key, list);
  }

  const first = new Date(Date.UTC(y, m - 1, 1));
  // Back up to the Sunday on or before the first of the month.
  const gridStart = new Date(first.getTime() - first.getUTCDay() * 86_400_000);
  const today = input.today ?? dayKey(new Date(), input.timeZone);

  const weeks: CalendarDay[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: CalendarDay[] = [];
    for (let d = 0; d < 7; d++) {
      const at = new Date(gridStart.getTime() + (w * 7 + d) * 86_400_000);
      const key = at.toISOString().slice(0, 10);
      row.push({
        date: key,
        dayOfMonth: at.getUTCDate(),
        inMonth: at.getUTCMonth() === m - 1 && at.getUTCFullYear() === y,
        isToday: key === today,
        items: byDay.get(key) ?? [],
      });
    }
    weeks.push(row);
  }

  const listed = input.items
    .filter((i) => i.dueAt && dayKey(i.dueAt, input.timeZone).startsWith(month))
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));

  return {
    month,
    label: `${MONTH_NAMES[m - 1]} ${y}`,
    weeks,
    listed,
    undated,
    prevMonth: shiftMonth(month, -1),
    nextMonth: shiftMonth(month, 1),
  };
}

/** `YYYY-MM` from a query string, or the current month. */
export function parseMonth(v: string | string[] | undefined, now = new Date()): string {
  const raw = Array.isArray(v) ? v[0] : v;
  if (raw && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) return raw;
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}
