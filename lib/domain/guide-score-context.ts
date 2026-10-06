export const SAVED_SCORE_NOTICE = "Saved scoring analysis is historical. It has not been verified against the current score, decision or deadline.";

export function currentScoreLine(score: number | null, tier: string | null, closed = false): string {
  const value = score != null && Number.isFinite(score)
    ? `Current recorded score: ${Math.round(score)}/100` : "Current score unavailable";
  return !closed && tier ? `${value} · Recorded tier: ${tier}` : value;
}

export function scoreHistoryNotice(current: number | null, recorded: number): string {
  return SAVED_SCORE_NOTICE + (current != null && Number.isFinite(current) && Number.isFinite(recorded) && current !== recorded
    ? ` Saved analysis total ${recorded} differs from the current recorded score ${current}.` : "");
}

/** Absolute UTC only: a panel left open must not promise stale remaining time. */
export function recordedDeadlineLine(value: string | Date | null | undefined): string {
  if (value == null || value === "") return "No deadline recorded.";
  if (typeof value === "string") {
    const parts = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.exec(value);
    if (!parts) return "Recorded deadline unavailable.";
    const [year, month, day, hour, minute, second] = parts.slice(1).map(part => Number(part ?? 0));
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]
      || hour > 23 || minute > 59 || second > 59) return "Recorded deadline unavailable.";
  }
  const date = new Date(value instanceof Date ? value.getTime() : value);
  if (!Number.isFinite(date.getTime())) return "Recorded deadline unavailable.";
  return `Recorded deadline: ${date.toLocaleString("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC.`;
}
