import { describe, it, expect } from "vitest";
import { cronMatches } from "@/lib/cron";
import { extractJson } from "@/lib/ai/claude";

describe("cron matcher", () => {
  it("matches every 2 hours at minute 0", () => {
    expect(cronMatches("0 */2 * * *", new Date("2026-07-03T08:00:00"))).toBe(true);
    expect(cronMatches("0 */2 * * *", new Date("2026-07-03T09:00:00"))).toBe(false);
    expect(cronMatches("0 */2 * * *", new Date("2026-07-03T08:01:00"))).toBe(false);
  });

  it("matches daily at a specific hour", () => {
    expect(cronMatches("0 8 * * *", new Date("2026-07-03T08:00:00"))).toBe(true);
    expect(cronMatches("0 8 * * *", new Date("2026-07-03T07:00:00"))).toBe(false);
  });

  it("matches weekly on Monday", () => {
    // 2026-07-06 is a Monday
    expect(cronMatches("0 9 * * 1", new Date("2026-07-06T09:00:00"))).toBe(true);
    expect(cronMatches("0 9 * * 1", new Date("2026-07-07T09:00:00"))).toBe(false);
  });

  it("matches step minutes */15", () => {
    expect(cronMatches("*/15 * * * *", new Date("2026-07-03T08:00:00"))).toBe(true);
    expect(cronMatches("*/15 * * * *", new Date("2026-07-03T08:15:00"))).toBe(true);
    expect(cronMatches("*/15 * * * *", new Date("2026-07-03T08:07:00"))).toBe(false);
  });

  it("rejects malformed expressions", () => {
    expect(cronMatches("bogus", new Date())).toBe(false);
    expect(cronMatches("* * *", new Date())).toBe(false);
  });
});

describe("extractJson", () => {
  it("parses clean JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses JSON inside code fences", () => {
    expect(extractJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
  });

  it("extracts the first balanced object from prose", () => {
    const text = 'Here is your result: {"score": 80, "tier": "pursue"} — done.';
    expect(extractJson(text)).toEqual({ score: 80, tier: "pursue" });
  });

  it("handles nested objects and strings with braces", () => {
    const text = 'noise {"a":{"b":"}{"},"c":[1,2]} trailing';
    expect(extractJson(text)).toEqual({ a: { b: "}{" }, c: [1, 2] });
  });

  it("throws when no JSON present", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});
