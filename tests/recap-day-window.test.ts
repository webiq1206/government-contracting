import { describe, expect, it } from "vitest";
import {
  addLocalDays,
  dayWindow,
  daysBetween,
  isValidTimeZone,
  localDateOf,
  parseSendAt,
  previousLocalDate,
  recapDue,
  safeTimeZone,
  sendAtLabel,
  zonedTimeToInstant,
} from "@/lib/domain/recap/day-window";

/**
 * The day boundary is the whole feature.
 *
 * Every figure in a recap is "what happened yesterday", and yesterday is a
 * different twenty-four hours for a reader in Boise and a reader in Boston.
 * Get this wrong and the arithmetic is wrong everywhere downstream, silently,
 * in a way that looks like the product inventing numbers.
 */

describe("the local day window", () => {
  it("covers midnight to midnight in the reader's zone, not the server's", () => {
    const w = dayWindow("2026-08-29", "America/Denver");
    // 2026-08-29 00:00 MDT is 06:00 UTC.
    expect(w.start.toISOString()).toBe("2026-08-29T06:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-08-30T06:00:00.000Z");
  });

  it("gives a different window to two readers on the same date", () => {
    const denver = dayWindow("2026-08-29", "America/Denver");
    const newYork = dayWindow("2026-08-29", "America/New_York");
    expect(denver.start.getTime()).not.toBe(newYork.start.getTime());
    expect(denver.start.getTime() - newYork.start.getTime()).toBe(2 * 3600_000);
  });

  it("is 23 hours long on the spring-forward day", () => {
    // US DST begins 2026-03-08.
    const w = dayWindow("2026-03-08", "America/Denver");
    expect((w.end.getTime() - w.start.getTime()) / 3600_000).toBe(23);
  });

  it("is 25 hours long on the fall-back day", () => {
    // US DST ends 2026-11-01.
    const w = dayWindow("2026-11-01", "America/Denver");
    expect((w.end.getTime() - w.start.getTime()) / 3600_000).toBe(25);
  });

  it("is always 24 hours where there is no daylight saving", () => {
    for (const date of ["2026-03-08", "2026-11-01"]) {
      const w = dayWindow(date, "America/Phoenix");
      expect((w.end.getTime() - w.start.getTime()) / 3600_000).toBe(24);
    }
  });

  it("leaves no gap and no overlap between consecutive days", () => {
    const a = dayWindow("2026-11-01", "America/Denver");
    const b = dayWindow("2026-11-02", "America/Denver");
    expect(a.end.getTime()).toBe(b.start.getTime());
  });

  it("resolves a time that does not exist on the spring-forward morning", () => {
    // 02:30 never happens on 2026-03-08 in Denver. It must land on something
    // real rather than NaN, or the send is scheduled for a moment that does
    // not occur and never fires.
    const at = zonedTimeToInstant("2026-03-08", 2, 30, "America/Denver");
    expect(Number.isNaN(at.getTime())).toBe(false);
    expect(localDateOf(at, "America/Denver")).toBe("2026-03-08");
  });

  it("lands after the missing hour, not an hour early", () => {
    /*
     * The bug this pins: resolving 02:30 by guessing an offset and re-reading
     * it settles on 01:30, which is BEFORE the gap, so a recap scheduled for
     * 02:30 went out an hour early once a year. The clocks jump from 02:00 to
     * 03:00, so the honest answer for 02:30 is 03:30, the first moment the
     * morning actually reaches it.
     */
    const at = zonedTimeToInstant("2026-03-08", 2, 30, "America/Denver");
    expect(at.toISOString()).toBe("2026-03-08T09:30:00.000Z");
    const before = zonedTimeToInstant("2026-03-08", 1, 30, "America/Denver");
    expect(at.getTime()).toBeGreaterThan(before.getTime());
  });

  it("takes the first of the two 01:30s on the morning the clocks go back", () => {
    // 01:30 happens twice on 2026-11-01 in Denver. The second is an hour late
    // for no reason anybody reading the mail would understand.
    const at = zonedTimeToInstant("2026-11-01", 1, 30, "America/Denver");
    expect(at.toISOString()).toBe("2026-11-01T07:30:00.000Z");
  });

  it("puts an ordinary send time exactly where it belongs", () => {
    // The case that must not regress while fixing the two above.
    expect(zonedTimeToInstant("2026-08-29", 6, 0, "America/Denver").toISOString()).toBe(
      "2026-08-29T12:00:00.000Z"
    );
    expect(zonedTimeToInstant("2026-01-15", 6, 0, "America/Denver").toISOString()).toBe(
      "2026-01-15T13:00:00.000Z"
    );
  });
});

describe("date arithmetic on the local date string", () => {
  it("moves by calendar days without a zone being involved", () => {
    expect(addLocalDays("2026-03-08", -1)).toBe("2026-03-07");
    expect(addLocalDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-08-25", "2026-08-29")).toBe(4);
  });

  it("reads yesterday in the reader's zone", () => {
    // 2026-08-30T04:00Z is still the 29th in Denver and already the 30th in
    // New York, so "yesterday" differs by a day between two colleagues.
    const now = new Date("2026-08-30T04:00:00Z");
    expect(previousLocalDate(now, "America/Denver")).toBe("2026-08-28");
    expect(previousLocalDate(now, "America/New_York")).toBe("2026-08-29");
  });
});

describe("an unrecognised zone", () => {
  it("falls back to Mountain rather than throwing", () => {
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(safeTimeZone("Mars/Olympus")).toBe("America/Denver");
    expect(safeTimeZone(null)).toBe("America/Denver");
    expect(safeTimeZone("America/New_York")).toBe("America/New_York");
  });
});

describe("the send time", () => {
  it("clamps anything unparseable to six in the morning", () => {
    expect(parseSendAt("06:00")).toEqual({ hour: 6, minute: 0 });
    expect(parseSendAt("07:30")).toEqual({ hour: 7, minute: 30 });
    expect(parseSendAt("31:00")).toEqual({ hour: 6, minute: 0 });
    expect(parseSendAt("nonsense")).toEqual({ hour: 6, minute: 0 });
    expect(parseSendAt(null)).toEqual({ hour: 6, minute: 0 });
  });

  it("reads as a time a person would say", () => {
    expect(sendAtLabel("06:00")).toBe("6:00 AM");
    expect(sendAtLabel("13:05")).toBe("1:05 PM");
    expect(sendAtLabel("00:30")).toBe("12:30 AM");
  });
});

describe("whether a recap is due", () => {
  const tz = "America/Denver";

  it("is not due before the send time", () => {
    // 05:45 local.
    const d = recapDue({ now: new Date("2026-08-30T11:45:00Z"), timezone: tz, sendAt: "06:00" });
    expect(d.due).toBe(false);
    expect(d.reason).toBe("before-window");
  });

  it("is due at the send time, and not late", () => {
    const d = recapDue({ now: new Date("2026-08-30T12:00:00Z"), timezone: tz, sendAt: "06:00" });
    expect(d.due).toBe(true);
    expect(d.late).toBe(false);
    expect(d.localDate).toBe("2026-08-30");
  });

  it("still sends a missed morning later the same day, marked late", () => {
    // 10:00 local, four hours after the send time.
    const d = recapDue({ now: new Date("2026-08-30T16:00:00Z"), timezone: tz, sendAt: "06:00" });
    expect(d.due).toBe(true);
    expect(d.late).toBe(true);
  });

  it("gives up past the cutoff rather than sending a stale morning at midnight", () => {
    // 20:00 local, fourteen hours after a 06:00 send with a 12 hour cutoff.
    const d = recapDue({
      now: new Date("2026-08-31T02:00:00Z"),
      timezone: tz,
      sendAt: "06:00",
      cutoffHours: 12,
    });
    expect(d.due).toBe(false);
    expect(d.reason).toBe("past-cutoff");
  });

  it("asks the question in each recipient's own zone", () => {
    // One instant: 06:15 in Denver, 08:15 in New York, 05:15 in Los Angeles.
    const now = new Date("2026-08-30T12:15:00Z");
    expect(recapDue({ now, timezone: "America/Denver", sendAt: "06:00" }).due).toBe(true);
    expect(recapDue({ now, timezone: "America/New_York", sendAt: "06:00" }).due).toBe(true);
    expect(recapDue({ now, timezone: "America/Los_Angeles", sendAt: "06:00" }).due).toBe(false);
  });

  it("keeps the morning label and the day it reports one day apart", () => {
    const d = recapDue({ now: new Date("2026-08-30T12:00:00Z"), timezone: tz, sendAt: "06:00" });
    expect(addLocalDays(d.localDate, -1)).toBe("2026-08-29");
  });

  it("does not skip or repeat a day when the recipient moves zone mid-stream", () => {
    /*
     * A person in New York whose 06:00 recap has already gone out changes
     * their zone to Los Angeles later the same morning. Read in the new zone
     * it is still 06:xx or later on the same local date, so the day key is
     * unchanged and the claim already exists: they do not get a second copy,
     * and tomorrow is not skipped.
     */
    const afterSend = new Date("2026-08-30T14:30:00Z"); // 10:30 NY, 07:30 LA
    const east = recapDue({ now: afterSend, timezone: "America/New_York", sendAt: "06:00" });
    const west = recapDue({ now: afterSend, timezone: "America/Los_Angeles", sendAt: "06:00" });
    expect(east.due && west.due).toBe(true);
    expect(east.localDate).toBe(west.localDate);
  });
});
