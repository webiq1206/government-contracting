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
