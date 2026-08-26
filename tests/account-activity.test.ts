import { describe, it, expect } from "vitest";
import {
  activityOf,
  DORMANT_DAYS,
  QUIET_DAYS,
  ACTIVITY_FILTERS,
} from "@/lib/domain/account-activity";

const NOW = new Date("2026-08-26T12:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

describe("activityOf", () => {
  it("separates never signed in from not lately", () => {
    // The distinction carries the only part that says what to do: one is a
    // failed onboarding and recoverable, the other is churn already under way.
    expect(activityOf(null, ago(40), NOW).state).toBe("never");
    expect(activityOf(ago(40), ago(90), NOW).state).toBe("dormant");
  });

  it("does not call a signup from this morning a failure", () => {
    const a = activityOf(null, ago(0), NOW);
    expect(a.state).toBe("never");
    expect(a.attention).toBe(false);
    expect(a.meaning).toContain("normal for the first few hours");
  });

  it("does flag a signup from last week that nobody ever opened", () => {
    const a = activityOf(null, ago(7), NOW);
    expect(a.attention).toBe(true);
    expect(a.meaning).toContain("7 days ago");
    expect(a.meaning).toContain("welcome email");
  });

  it("says so rather than guessing when there is no signup date either", () => {
    const a = activityOf(null, null, NOW);
    expect(a.meaning).toContain("no signup date");
    expect(a.attention).toBe(false);
  });

  it("calls a long gap dormant and says what it costs", () => {
    const a = activityOf(ago(DORMANT_DAYS), ago(200), NOW);
    expect(a.state).toBe("dormant");
    expect(a.attention).toBe(true);
    expect(a.meaning).toContain("cancellation waiting to happen");
    expect(a.daysSince).toBe(DORMANT_DAYS);
  });

  it("calls a middling gap quiet without raising it as a problem", () => {
    const a = activityOf(ago(QUIET_DAYS), ago(200), NOW);
    expect(a.state).toBe("quiet");
    expect(a.attention).toBe(false);
  });

  it("calls recent use active", () => {
    expect(activityOf(ago(0), ago(200), NOW).label).toBe("Signed in today");
    expect(activityOf(ago(1), ago(200), NOW).label).toBe("Last signed in 1 day ago");
    expect(activityOf(ago(3), ago(200), NOW).state).toBe("active");
  });

  it("does not fall over on an unparseable timestamp", () => {
    const a = activityOf("whenever", "also whenever", NOW);
    expect(a.state).toBe("never");
    expect(a.daysSince).toBeNull();
  });

  it("treats a future sign-in as today rather than as a negative age", () => {
    const a = activityOf(new Date(NOW.getTime() + 3_600_000), ago(10), NOW);
    expect(a.state).toBe("active");
    expect(a.label).toBe("Signed in today");
  });

  it("offers a filter for each state", () => {
    expect(ACTIVITY_FILTERS.map((f) => f.value)).toEqual([
      "never",
      "dormant",
      "quiet",
      "active",
    ]);
  });
});
