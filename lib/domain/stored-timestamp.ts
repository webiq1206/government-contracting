/**
 * Stored event times must mean the same thing in server-rendered
 * history and hydrated views. UTC is explicit here; neither the
 * server's timezone nor the reader's browser decides what a saved time means.
 */
export function storedTimestamp(
  value: string | Date | null | undefined,
  { seconds = false }: { seconds?: boolean } = {},
): {
  label: string;
  dateTime: string | undefined;
} {
  const unavailable = { label: "Time unavailable", dateTime: undefined };
  let date: Date;
  if (value instanceof Date) {
    date = value;
  } else {
    if (typeof value !== "string") return unavailable;
    // Accept ISO instants and PostgreSQL timestamptz text. A timezone-less
    // string is not an instant: do not silently assign UTC or a local zone.
    const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,6})?)?(Z|[+-]\d{2}(?::?\d{2})?)$/i.exec(value.trim());
    if (!match) return unavailable;
    const [, day, hour, minute, second = "00", fraction = "", offset] = match;
    if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return unavailable;
    // Date.parse normalizes some impossible dates (for example February 30).
    const calendarDay = new Date(`${day}T00:00:00Z`);
    if (!Number.isFinite(calendarDay.getTime()) || calendarDay.toISOString().slice(0, 10) !== day) return unavailable;
    const zone = offset.toUpperCase() === "Z" ? "Z"
      : offset.length === 3 ? `${offset}:00`
      : offset.length === 5 ? `${offset.slice(0, 3)}:${offset.slice(3)}` : offset;
    date = new Date(`${day}T${hour}:${minute}:${second}${fraction.slice(0, 4)}${zone}`);
  }
  if (!Number.isFinite(date.getTime())) return unavailable;
  return {
    label: date.toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
      second: seconds ? "2-digit" : undefined,
      timeZone: "UTC", timeZoneName: "short", hour12: true,
    }),
    dateTime: date.toISOString(),
  };
}
