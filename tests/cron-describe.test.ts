/**
 * The roster showed operators a raw cron field and nothing else. These are the
 * expressions the registry actually schedules, so each one has to come back as
 * a sentence a person can act on -- and anything unrecognised has to come back
 * as itself rather than as a confident guess.
 */
import { describe, it, expect } from "vitest";
import {
  describeCron,
  scheduleLabel,
  nextRunAt,
  nextRunAcross,
} from "../lib/domain/cron-describe";
import { scheduledAgents } from "../lib/agents/registry";

describe("describeCron", () => {
  it("says the intervals the registry uses", () => {
    expect(describeCron("*/15 * * * *")).toBe("Every 15 minutes");
    expect(describeCron("*/10 * * * *")).toBe("Every 10 minutes");
    expect(describeCron("0 */3 * * *")).toBe("Every 3 hours");
    expect(describeCron("0 */2 * * *")).toBe("Every 2 hours");
    expect(describeCron("0 */6 * * *")).toBe("Every 6 hours");
  });

  it("says hourly schedules, including ones offset past the hour", () => {
    expect(describeCron("0 * * * *")).toBe("Every hour");
    expect(describeCron("15 * * * *")).toBe("Every hour, at 15 past");
    expect(describeCron("5 * * * *")).toBe("Every hour, at 5 past");
  });

  it("says daily and weekly schedules as clock times", () => {
    expect(describeCron("0 8 * * *")).toBe("Daily at 8:00 AM");
    expect(describeCron("45 3 * * *")).toBe("Daily at 3:45 AM");
    expect(describeCron("0 13 * * *")).toBe("Daily at 1:00 PM");
    expect(describeCron("0 0 * * *")).toBe("Daily at 12:00 AM");
    expect(describeCron("0 9 * * 1")).toBe("Mondays at 9:00 AM");
  });

  it("has no schedule to describe for an event-triggered agent", () => {
    expect(describeCron(null)).toBeNull();
    expect(describeCron("")).toBeNull();
    expect(describeCron(undefined)).toBeNull();
  });

  it("returns the expression unchanged when it does not recognise the shape", () => {
    // Inventing a sentence for a cron nobody anticipated is how a schedule gets
    // misread. The machine string is at least true.
    expect(describeCron("0 0 1 1 *")).toBe("0 0 1 1 *");
    expect(describeCron("not a cron")).toBe("not a cron");
    expect(describeCron("* * *")).toBe("* * *");
  });
});

describe("scheduleLabel", () => {
  it("marks wall-clock times as UTC, because that is what they are", () => {
    // Read as local time, "Daily at 3:45 AM" is wrong by hours for most people.
    expect(scheduleLabel("45 3 * * *")).toBe("Daily at 3:45 AM UTC");
    expect(scheduleLabel("0 9 * * 1")).toBe("Mondays at 9:00 AM UTC");
  });

  it("leaves intervals alone, since no clock time is being claimed", () => {
    expect(scheduleLabel("*/15 * * * *")).toBe("Every 15 minutes");
    expect(scheduleLabel("0 */3 * * *")).toBe("Every 3 hours");
  });

  it("says plainly when an agent has no schedule", () => {
    expect(scheduleLabel(null)).toBe("Runs when something triggers it");
  });

  it("describes every schedule the registry actually ships", () => {
    // The guard that matters: a new agent with an unhandled cron shape shows up
    // here as a raw expression, and this test says so before an operator sees it.
    const undescribed = scheduledAgents()
      .map((a) => a.cron)
      .filter((c): c is string => Boolean(c))
      .filter((c) => describeCron(c) === c);
    expect(undescribed).toEqual([]);
  });
});

describe("nextRunAt", () => {
  // A Tuesday, 09:07:33 UTC.
  const now = new Date("2026-08-25T09:07:33.000Z");

  it("finds the next slot of an every-N-minutes schedule", () => {
    expect(nextRunAt("*/15 * * * *", now)?.toISOString()).toBe("2026-08-25T09:15:00.000Z");
    expect(nextRunAt("*/10 * * * *", now)?.toISOString()).toBe("2026-08-25T09:10:00.000Z");
  });

  it("drops the seconds rather than firing in the past", () => {
    const at = nextRunAt("*/15 * * * *", now);
    expect(at!.getUTCSeconds()).toBe(0);
    expect(at!.getTime()).toBeGreaterThan(now.getTime());
  });

  it("rolls to the next hour when this hour's slot has gone", () => {
    expect(nextRunAt("5 * * * *", now)?.toISOString()).toBe("2026-08-25T10:05:00.000Z");
    expect(nextRunAt("15 * * * *", now)?.toISOString()).toBe("2026-08-25T09:15:00.000Z");
  });

  it("handles every-N-hours", () => {
    expect(nextRunAt("0 */2 * * *", now)?.toISOString()).toBe("2026-08-25T10:00:00.000Z");
    expect(nextRunAt("0 */6 * * *", now)?.toISOString()).toBe("2026-08-25T12:00:00.000Z");
  });

  it("rolls a daily schedule to tomorrow once today's time has passed", () => {
    expect(nextRunAt("45 3 * * *", now)?.toISOString()).toBe("2026-08-26T03:45:00.000Z");
    expect(nextRunAt("20 6 * * *", now)?.toISOString()).toBe("2026-08-26T06:20:00.000Z");
    expect(nextRunAt("40 9 * * *", now)?.toISOString()).toBe("2026-08-25T09:40:00.000Z");
  });

  it("finds the next weekday for a weekly schedule", () => {
    // Tuesday is day 2, so the next Monday is six days out.
    expect(nextRunAt("0 9 * * 1", now)?.toISOString()).toBe("2026-08-31T09:00:00.000Z");
  });

  it("says nothing rather than guessing when there is no schedule", () => {
    expect(nextRunAt(null, now)).toBeNull();
    expect(nextRunAt("", now)).toBeNull();
    expect(nextRunAt("   ", now)).toBeNull();
  });

  it("says nothing for an expression it cannot parse", () => {
    expect(nextRunAt("not a cron", now)).toBeNull();
    expect(nextRunAt("0 9 * *", now)).toBeNull();
    expect(nextRunAt("0 9 * * * *", now)).toBeNull();
    expect(nextRunAt("*/0 * * * *", now)).toBeNull();
    expect(nextRunAt("99 * * * *", now)).toBeNull();
    expect(nextRunAt("0 JAN * * *", now)).toBeNull();
  });

  it("says nothing for a schedule that fires beyond the lookahead", () => {
    // The 1st of February from a Tuesday in August is far outside a week.
    expect(nextRunAt("0 6 1 2 *", now)).toBeNull();
  });

  it("treats a restricted day-of-month and day-of-week as an or, the way cron does", () => {
    // The 27th, or any Friday. Friday the 28th is later than Thursday the 27th.
    expect(nextRunAt("0 0 27 * 5", now)?.toISOString()).toBe("2026-08-27T00:00:00.000Z");
  });

  it("accepts lists and ranges", () => {
    expect(nextRunAt("0,30 * * * *", now)?.toISOString()).toBe("2026-08-25T09:30:00.000Z");
    expect(nextRunAt("0 10-14 * * *", now)?.toISOString()).toBe("2026-08-25T10:00:00.000Z");
  });
});

describe("nextRunAcross", () => {
  const now = new Date("2026-08-25T09:07:33.000Z");

  it("returns the soonest of several schedules", () => {
    expect(nextRunAcross(["45 3 * * *", "*/10 * * * *", "0 */6 * * *"], now)?.toISOString()).toBe(
      "2026-08-25T09:10:00.000Z"
    );
  });

  it("ignores the ones it cannot predict rather than being defeated by them", () => {
    expect(nextRunAcross([null, "gibberish", "0 */6 * * *"], now)?.toISOString()).toBe(
      "2026-08-25T12:00:00.000Z"
    );
  });

  it("returns nothing when nothing is predictable", () => {
    expect(nextRunAcross([null, "", "gibberish"], now)).toBeNull();
  });
});
