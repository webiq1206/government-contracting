import { describe, it, expect } from "vitest";
import {
  deadlineStatus,
  daysBetween,
  statusColor,
  nonSsCapState,
} from "@/lib/domain/compliance";

describe("compliance thresholds", () => {
  const cadence = [90, 30, 7];

  it("maps days remaining to a state by cadence", () => {
    /*
     * One threshold rather than two. The cadence used to split into "warning"
     * and "critical", which was severity dressed as state: both meant a dated
     * item is inside its warning window, and the only real difference between
     * them was the number of days, which is shown anyway.
     */
    expect(deadlineStatus(120, cadence)).toBe("complete");
    expect(deadlineStatus(60, cadence)).toBe("expiring_soon");
    expect(deadlineStatus(20, cadence)).toBe("expiring_soon");
    expect(deadlineStatus(5, cadence)).toBe("expiring_soon");
  });

  it("blocks at/after zero when blockAtZero set, and expires otherwise", () => {
    expect(deadlineStatus(0, cadence, { blockAtZero: true })).toBe("blocked");
    expect(deadlineStatus(-3, cadence, { blockAtZero: true })).toBe("blocked");
    expect(deadlineStatus(0, cadence)).toBe("expired");
    expect(deadlineStatus(-3, cadence)).toBe("expired");
  });

  it("daysBetween counts forward days", () => {
    const a = new Date("2026-01-01T00:00:00Z");
    const b = new Date("2026-01-11T00:00:00Z");
    expect(daysBetween(a, b)).toBe(10);
  });

  it("statusColor maps to green/amber/red", () => {
    expect(statusColor("complete")).toBe("green");
    expect(statusColor("expiring_soon")).toBe("amber");
    expect(statusColor("expired")).toBe("red");
    expect(statusColor("blocked")).toBe("red");
    expect(statusColor("conflicting")).toBe("red");
  });

  it("does not colour an unknown item green", () => {
    /*
     * Everything the monitor had not flagged used to go green, which is how
     * an item nobody could check ended up looking as settled as one renewed
     * last week. Neither of these is a problem today and neither is finished.
     */
    expect(statusColor("cannot_monitor")).toBe("amber");
    expect(statusColor("incomplete")).toBe("amber");
  });

  it("non-SS cap: alert at 45, block additional at 49 (cap 50)", () => {
    expect(nonSsCapState(30, 50, 45)).toMatchObject({ status: "complete", alert: false, blockAdditional: false });
    expect(nonSsCapState(46, 50, 45)).toMatchObject({ status: "expiring_soon", alert: true, blockAdditional: false });
    expect(nonSsCapState(49, 50, 45)).toMatchObject({ status: "blocked", blockAdditional: true });
    expect(nonSsCapState(55, 50, 45).blockAdditional).toBe(true);
  });
});
