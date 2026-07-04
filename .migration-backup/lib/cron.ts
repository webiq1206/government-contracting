/**
 * Minimal standard 5-field cron matcher (minute hour day-of-month month
 * day-of-week). Supports a wildcard, step values (slash-n), ranges (a-b), and
 * comma lists. Enough for the agent schedules; no external dependency. Evaluated
 * once per minute by the worker scheduler.
 */
export function cronMatches(expr: string, date: Date): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [min, hour, dom, mon, dow] = fields;
  return (
    matchField(min, date.getMinutes(), 0, 59) &&
    matchField(hour, date.getHours(), 0, 23) &&
    matchField(dom, date.getDate(), 1, 31) &&
    matchField(mon, date.getMonth() + 1, 1, 12) &&
    matchField(dow, date.getDay(), 0, 6) // 0 = Sunday
  );
}

function matchField(field: string, value: number, lo: number, hi: number): boolean {
  if (field === "*") return true;
  for (const part of field.split(",")) {
    if (matchPart(part, value, lo, hi)) return true;
  }
  return false;
}

function matchPart(part: string, value: number, lo: number, hi: number): boolean {
  // step: */n or a-b/n or a/n
  let step = 1;
  let range = part;
  const slash = part.indexOf("/");
  if (slash !== -1) {
    step = parseInt(part.slice(slash + 1), 10) || 1;
    range = part.slice(0, slash);
  }
  let start = lo;
  let end = hi;
  if (range !== "*") {
    const dash = range.indexOf("-");
    if (dash !== -1) {
      start = parseInt(range.slice(0, dash), 10);
      end = parseInt(range.slice(dash + 1), 10);
    } else {
      start = end = parseInt(range, 10);
    }
  }
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  if (value < start || value > end) return false;
  return (value - start) % step === 0;
}
