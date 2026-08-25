/**
 * The roster showed operators a raw cron field and nothing else. These are the
 * expressions the registry actually schedules, so each one has to come back as
 * a sentence a person can act on -- and anything unrecognised has to come back
 * as itself rather than as a confident guess.
 */
import { describe, it, expect } from "vitest";
import { describeCron, scheduleLabel } from "../lib/domain/cron-describe";
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
