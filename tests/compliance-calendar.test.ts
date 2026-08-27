import { describe, expect, it } from "vitest";
import {
  buildCalendar,
  dayKey,
  parseMonth,
  type CalendarItem,
} from "@/lib/domain/compliance-calendar";

function item(id: string, dueAt: string): CalendarItem {
  return { id, label: `Item ${id}`, dueAt, state: "expiring_soon", tone: "amber" };
}

describe("the grid", () => {
  it("always has six rows of seven, so the page does not change height", () => {
    for (const month of ["2026-02", "2026-08", "2027-01"]) {
      const cal = buildCalendar({ month, items: [] });
      expect(cal.weeks).toHaveLength(6);
      for (const w of cal.weeks) expect(w).toHaveLength(7);
    }
  });

  it("starts each row on a Sunday and pads either end", () => {
    // 1 August 2026 is a Saturday, so the first row is six padding days.
    const cal = buildCalendar({ month: "2026-08", items: [] });
    expect(cal.weeks[0][0].date).toBe("2026-07-26");
    expect(cal.weeks[0].filter((d) => d.inMonth)).toHaveLength(1);
    expect(cal.weeks[0][6].date).toBe("2026-08-01");
    expect(cal.weeks[0][6].inMonth).toBe(true);
  });

  it("puts an item in its own square", () => {
    const cal = buildCalendar({ month: "2026-08", items: [item("a", "2026-08-14T00:00:00Z")] });
    const day = cal.weeks.flat().find((d) => d.date === "2026-08-14")!;
    expect(day.items.map((i) => i.id)).toEqual(["a"]);
  });

  it("stacks several on the same day, which is the thing worth seeing", () => {
    const cal = buildCalendar({
      month: "2026-08",
      items: [
        item("a", "2026-08-14T00:00:00Z"),
        item("b", "2026-08-14T09:00:00Z"),
        item("c", "2026-08-14T23:00:00Z"),
      ],
    });
    const day = cal.weeks.flat().find((d) => d.date === "2026-08-14")!;
    expect(day.items).toHaveLength(3);
  });

  it("marks today, and only today", () => {
    const cal = buildCalendar({ month: "2026-08", items: [], today: "2026-08-14" });
    const marked = cal.weeks.flat().filter((d) => d.isToday);
    expect(marked).toHaveLength(1);
    expect(marked[0].date).toBe("2026-08-14");
  });

  it("keeps an item with no date out of the grid rather than putting it somewhere", () => {
    /*
     * No square is the right square for a date nobody has supplied, and
     * dropping it into today would be a claim the record cannot support.
     */
    const cal = buildCalendar({ month: "2026-08", items: [item("a", "")] });
    expect(cal.weeks.flat().every((d) => d.items.length === 0)).toBe(true);
    expect(cal.undated.map((i) => i.id)).toEqual(["a"]);
  });

  it("lists only this month's items beneath it, in date order", () => {
    const cal = buildCalendar({
      month: "2026-08",
      items: [
        item("late", "2026-08-28T00:00:00Z"),
        item("early", "2026-08-03T00:00:00Z"),
        item("next", "2026-09-03T00:00:00Z"),
      ],
    });
    expect(cal.listed.map((i) => i.id)).toEqual(["early", "late"]);
  });

  it("names the months either side, including across a year boundary", () => {
    expect(buildCalendar({ month: "2026-12", items: [] }).nextMonth).toBe("2027-01");
    expect(buildCalendar({ month: "2026-01", items: [] }).prevMonth).toBe("2025-12");
  });

  it("falls back to this month rather than throwing on a nonsense one", () => {
    const cal = buildCalendar({ month: "not-a-month", items: [] });
    expect(cal.month).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe("which day an instant falls on", () => {
  it("uses the timezone the obligation lives in", () => {
    /*
     * A renewal deadline is a wall-clock date somewhere. Late-evening UTC is
     * the same day in Denver and the next day in Tokyo, and a grid built from
     * the server's midnight puts it in the wrong square for one of them.
     */
    const at = "2026-08-14T23:30:00Z";
    expect(dayKey(at, "America/Denver")).toBe("2026-08-14");
    expect(dayKey(at, "Asia/Tokyo")).toBe("2026-08-15");
  });

  it("falls back to UTC on an unknown timezone rather than taking out the calendar", () => {
    // A bad value in one row must not break the grid for every other row.
    expect(dayKey("2026-08-14T12:00:00Z", "Mars/Olympus")).toBe("2026-08-14");
    expect(dayKey("2026-08-14T12:00:00Z", null)).toBe("2026-08-14");
  });

  it("returns nothing for a date that is not one", () => {
    expect(dayKey("not a date")).toBe("");
  });
});

describe("the month in the address bar", () => {
  it("takes a well-formed month", () => {
    expect(parseMonth("2027-03")).toBe("2027-03");
  });

  it("refuses a month that does not exist, and one that is not a month", () => {
    const now = new Date("2026-08-27T00:00:00Z");
    expect(parseMonth("2027-13", now)).toBe("2026-08");
    expect(parseMonth("2027-00", now)).toBe("2026-08");
    expect(parseMonth("../../etc", now)).toBe("2026-08");
    expect(parseMonth(undefined, now)).toBe("2026-08");
  });
});
