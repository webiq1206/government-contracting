import { describe, it, expect } from "vitest";
import { cronMatches } from "@/lib/cron";
import { extractJson, JSON_RETRY_TOKEN_CAP, JSON_RETRY_TOKEN_HARD_CAP } from "@/lib/ai/claude";
import { readFileSync } from "node:fs";

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
    const text = 'Here is your result: {"score": 80, "tier": "pursue"}, done.';
    expect(extractJson(text)).toEqual({ score: 80, tier: "pursue" });
  });

  it("handles nested objects and strings with braces", () => {
    const text = 'noise {"a":{"b":"}{"},"c":[1,2]} trailing';
    expect(extractJson(text)).toEqual({ a: { b: "}{" }, c: [1, 2] });
  });

  it("throws when no JSON present", () => {
    expect(() => extractJson("no json here")).toThrow();
  });

  it("gives a truncated analysis room to finish on retry", () => {
    const src = readFileSync("lib/ai/claude.ts", "utf8");
    expect(JSON_RETRY_TOKEN_CAP).toBeGreaterThan(8192);
    expect(JSON_RETRY_TOKEN_HARD_CAP).toBeGreaterThan(JSON_RETRY_TOKEN_CAP);
    expect(src).toContain("JSON_RETRY_TOKEN_HARD_CAP");
    expect(readFileSync("lib/agents/solicitation-analyst.ts", "utf8")).toContain(
      "maxTokens: JSON_RETRY_TOKEN_CAP"
    );
  });

  it("closes a cut-off object so the fields that arrived are kept", () => {
    expect(extractJson('{"scope":"Paint the hangar","trades":["painting"')).toEqual({
      scope: "Paint the hangar",
      trades: ["painting"],
    });
  });

  it("closes a cut-off string so the fields that arrived are kept", () => {
    expect(extractJson('{"scope":"Paint the hangar","draft":"The contractor shall')).toEqual({
      scope: "Paint the hangar",
      draft: "The contractor shall",
    });
  });
});
