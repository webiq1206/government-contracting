import { describe, it, expect } from "vitest";
import {
  deadlineStatus,
  daysBetween,
  statusColor,
  nonSsCapState,
} from "@/lib/domain/compliance";

describe("compliance thresholds", () => {
  const cadence = [90, 30, 7];

  it("maps days remaining to status by cadence", () => {
    expect(deadlineStatus(120, cadence)).toBe("ok");
    expect(deadlineStatus(60, cadence)).toBe("warning");
    expect(deadlineStatus(20, cadence)).toBe("warning");
    expect(deadlineStatus(5, cadence)).toBe("critical");
  });

  it("blocks at/after zero when blockAtZero set", () => {
    expect(deadlineStatus(0, cadence, { blockAtZero: true })).toBe("blocked");
    expect(deadlineStatus(-3, cadence, { blockAtZero: true })).toBe("blocked");
    expect(deadlineStatus(0, cadence)).toBe("critical");
  });

  it("daysBetween counts forward days", () => {
    const a = new Date("2026-01-01T00:00:00Z");
    const b = new Date("2026-01-11T00:00:00Z");
    expect(daysBetween(a, b)).toBe(10);
  });

  it("statusColor maps to green/amber/red", () => {
    expect(statusColor("ok")).toBe("green");
    expect(statusColor("warning")).toBe("amber");
    expect(statusColor("critical")).toBe("red");
    expect(statusColor("blocked")).toBe("red");
  });

  it("non-SS cap: alert at 45, block additional at 49 (cap 50)", () => {
    expect(nonSsCapState(30, 50, 45)).toMatchObject({ status: "ok", alert: false, blockAdditional: false });
    expect(nonSsCapState(46, 50, 45)).toMatchObject({ status: "warning", alert: true, blockAdditional: false });
    expect(nonSsCapState(49, 50, 45)).toMatchObject({ status: "blocked", blockAdditional: true });
    expect(nonSsCapState(55, 50, 45).blockAdditional).toBe(true);
  });
});
