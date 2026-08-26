/**
 * Saying a schedule in English.
 *
 * The roster printed the raw cron field next to every agent, so an operator
 * read "0 star-slash-3 star star star" and learned nothing from it.
 * That is the schedule written for the machine that reads it, and it answers
 * none of the questions an operator has when they open the page. Worse, it
 * reads as noise, so the whole row gets skipped and the agent's real state
 * (did it run, did it work) goes unnoticed underneath.
 *
 * This covers the shapes the registry actually uses and falls back to the raw
 * expression for anything else, which is the honest answer for a cron nobody
 * anticipated: better a machine string than a confident wrong sentence.
 */

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "8" -> "8:00 AM", "0" -> "12:00 AM", "13" -> "1:00 PM". */
function clockTime(hour: number, minute: number): string {
  const suffix = hour < 12 ? "AM" : "PM";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function plural(n: number, unit: string): string {
  return n === 1 ? `every ${unit}` : `every ${n} ${unit}s`;
}

/**
 * A human sentence for a 5-field cron expression, or null when there is no
 * schedule at all (the agent is triggered by events instead).
 */
export function describeCron(cron: string | null | undefined): string | null {
  const expr = (cron ?? "").trim();
  if (!expr) return null;

  const parts = expr.split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, mon, dow] = parts;

  // Every N minutes: "*/15 * * * *"
  if (/^\*\/\d+$/.test(min) && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    return `Every ${Number(min.slice(2))} minutes`;
  }
  // Every hour, on a given minute: "15 * * * *"
  if (/^\d+$/.test(min) && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    const m = Number(min);
    return m === 0 ? "Every hour" : `Every hour, at ${m} past`;
  }
  // Every N hours: "0 */3 * * *"
  if (/^\d+$/.test(min) && /^\*\/\d+$/.test(hour) && dom === "*" && mon === "*" && dow === "*") {
    const n = Number(hour.slice(2));
    const at = Number(min) === 0 ? "" : ` at ${Number(min)} past`;
    return `${plural(n, "hour").replace(/^e/, "E")}${at}`;
  }
  // Daily at a time: "0 8 * * *"
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === "*" && mon === "*" && dow === "*") {
    return `Daily at ${clockTime(Number(hour), Number(min))}`;
  }
  // Weekly on one day: "0 9 * * 1"
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === "*" && mon === "*" && /^[0-6]$/.test(dow)) {
    return `${DAYS[Number(dow)]}s at ${clockTime(Number(hour), Number(min))}`;
  }
  // Monthly on one date: "0 6 1 * *"
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && /^\d+$/.test(dom) && mon === "*" && dow === "*") {
    return `Monthly on the ${Number(dom)}${ordinal(Number(dom))} at ${clockTime(Number(hour), Number(min))}`;
  }

  // Not a shape this knows. The raw expression is at least accurate.
  return expr;
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][n % 10] ?? "th";
}

/**
 * Times are stored and scheduled in UTC, so a bare "8:00 AM" would be read as
 * local and quietly mislead. Only worth appending where a wall-clock time is
 * actually named.
 */
export function scheduleLabel(cron: string | null | undefined): string {
  const described = describeCron(cron);
  if (!described) return "Runs when something triggers it";
  return /\d:\d\d (AM|PM)/.test(described) ? `${described} UTC` : described;
}

// ---------------------------------------------------------------------------
// When it next fires
// ---------------------------------------------------------------------------

/** How far ahead a next run is worth searching for. */
const LOOKAHEAD_MINUTES = 8 * 24 * 60;

/**
 * Expands one cron field into the set of values it matches.
 *
 * Returns null for anything the parser does not understand, and null means
 * "cannot say" all the way up: a schedule nobody anticipated produces no
 * predicted time rather than a wrong one. That distinction matters here more
 * than usual, because "next run in 12 minutes" is the sentence that stops
 * somebody manually re-running work that was about to happen anyway.
 */
function fieldValues(field: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const step = part.split("/");
    if (step.length > 2) return null;
    const every = step.length === 2 ? Number(step[1]) : 1;
    if (!Number.isInteger(every) || every < 1) return null;
    const base = step[0];
    let lo: number;
    let hi: number;
    if (base === "*") {
      lo = min;
      hi = max;
    } else if (/^\d+$/.test(base)) {
      lo = Number(base);
      hi = step.length === 2 ? max : lo;
    } else if (/^\d+-\d+$/.test(base)) {
      const [a, b] = base.split("-").map(Number);
      lo = a;
      hi = b;
    } else {
      return null;
    }
    if (lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += every) out.add(v);
  }
  return out.size > 0 ? out : null;
}

/**
 * The next UTC instant a 5-field cron expression fires, or null.
 *
 * Null covers three different situations and the caller must not collapse
 * them into a time: no schedule at all (the agent is event-triggered), a
 * schedule this parser does not recognise, and a schedule that fires less
 * often than the lookahead window. Guessing in any of those cases would put a
 * confident wrong time on a page whose whole purpose is to be trusted about
 * whether work is happening.
 *
 * Scheduling is UTC everywhere in this system, so this works in UTC too.
 */
export function nextRunAt(cron: string | null | undefined, now = new Date()): Date | null {
  const expr = (cron ?? "").trim();
  if (!expr) return null;
  const parts = expr.split(/\s+/);
  if (parts.length !== 5) return null;
  const mins = fieldValues(parts[0], 0, 59);
  const hours = fieldValues(parts[1], 0, 23);
  const doms = fieldValues(parts[2], 1, 31);
  const mons = fieldValues(parts[3], 1, 12);
  const dows = fieldValues(parts[4], 0, 6);
  if (!mins || !hours || !doms || !mons || !dows) return null;

  // Cron treats day-of-month and day-of-week as an OR when both are restricted,
  // and as an AND when either is unrestricted. Getting this backwards is the
  // classic way to predict a run on the wrong day.
  const domRestricted = parts[2] !== "*";
  const dowRestricted = parts[4] !== "*";

  const t = new Date(now.getTime());
  t.setUTCSeconds(0, 0);
  t.setUTCMinutes(t.getUTCMinutes() + 1);
  for (let i = 0; i < LOOKAHEAD_MINUTES; i += 1) {
    const dayOk =
      domRestricted && dowRestricted
        ? doms.has(t.getUTCDate()) || dows.has(t.getUTCDay())
        : (!domRestricted || doms.has(t.getUTCDate())) &&
          (!dowRestricted || dows.has(t.getUTCDay()));
    if (
      mins.has(t.getUTCMinutes()) &&
      hours.has(t.getUTCHours()) &&
      mons.has(t.getUTCMonth() + 1) &&
      dayOk
    ) {
      return t;
    }
    t.setUTCMinutes(t.getUTCMinutes() + 1);
  }
  return null;
}

/**
 * The soonest next run across a set of schedules, which is what an operator
 * asking "when will anything happen" wants. Null when nothing is predictable.
 */
export function nextRunAcross(
  crons: (string | null | undefined)[],
  now = new Date()
): Date | null {
  let soonest: Date | null = null;
  for (const c of crons) {
    const at = nextRunAt(c, now);
    if (at && (!soonest || at < soonest)) soonest = at;
  }
  return soonest;
}
