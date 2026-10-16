import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, normalizeRules } from "@/lib/domain/intake";
import {
  addBusinessDays,
  closesInsideLeadTime,
  DEFAULT_REVIEW_LEAD_BUSINESS_DAYS,
  LEAD_PASS_NOTE,
} from "@/lib/domain/review-lead";

describe("business-day lead time", () => {
  it("defaults to five business days and can be turned off", () => {
    expect(DEFAULT_RULES.review_close_lead_business_days).toBe(DEFAULT_REVIEW_LEAD_BUSINESS_DAYS);
    expect(DEFAULT_REVIEW_LEAD_BUSINESS_DAYS).toBe(5);
    expect(normalizeRules({}).review_close_lead_business_days).toBe(5);
    expect(normalizeRules({ review_close_lead_business_days: 0 }).review_close_lead_business_days).toBe(0);
    expect(normalizeRules({ review_close_lead_business_days: 99 }).review_close_lead_business_days).toBe(60);
  });

  it("walks five business days across a weekend", () => {
    // Friday 16 Oct 2026. Five business days later is Friday 23 Oct.
    const friday = new Date("2026-10-16T15:00:00.000Z");
    expect(addBusinessDays(friday, 5).toISOString()).toBe("2026-10-23T15:00:00.000Z");
    // Thursday 15 Oct. Five business days later is Thursday 22 Oct.
    const thursday = new Date("2026-10-15T15:00:00.000Z");
    expect(addBusinessDays(thursday, 5).toISOString()).toBe("2026-10-22T15:00:00.000Z");
  });

  it("treats a past deadline and a short one as inside the window", () => {
    const now = new Date("2026-10-16T15:00:00.000Z");
    expect(closesInsideLeadTime(new Date("2026-10-10T15:00:00.000Z"), now, 5)).toBe(true);
    expect(closesInsideLeadTime(new Date("2026-10-22T15:00:00.000Z"), now, 5)).toBe(true);
    expect(closesInsideLeadTime(new Date("2026-10-23T15:00:00.000Z"), now, 5)).toBe(false);
    expect(closesInsideLeadTime(new Date("2026-11-02T15:00:00.000Z"), now, 5)).toBe(false);
    expect(closesInsideLeadTime(new Date("2026-10-10T15:00:00.000Z"), now, 0)).toBe(false);
  });
});

describe("lead-time cleanup", () => {
  const migration = readFileSync("db/migrations/135_provider_recovery_and_review_cleanup.sql", "utf8");
  const script = readFileSync("scripts/cleanup-stale-review.ts", "utf8");
  const pass = readFileSync("lib/review-lead-pass.ts", "utf8");

  it("is additive", () => {
    const banned = /\bdrop\s+table\b|\bdrop\s+schema\b|\btruncate\b/i;
    expect(migration).not.toMatch(banned);
    expect(script).not.toMatch(banned);
    expect(pass).not.toMatch(banned);
  });

  it("archives only open review items and can be run twice", () => {
    expect(migration).toContain(LEAD_PASS_NOTE);
    expect(pass).toContain("LEAD_PASS_NOTE");
    expect(migration).toContain("tier = 'review'");
    expect(migration).toContain("status = 'open'");
    expect(migration).toContain("stage in ('monitoring', 'scoring')");
    expect(migration).toContain("position(pass_note in notes)");
    expect(pass).toContain("where org_id = $1");
    expect(script).toContain("--apply");
  });

  it("runs even when automatic review dismissal is off", () => {
    const src = readFileSync("lib/agents/maintenance.ts", "utf8");
    const sweep = src.slice(src.indexOf('name: "review-expiry-sweep"'), src.indexOf("stalledPipelineSweep"));
    const beforeGate = sweep.slice(0, sweep.indexOf("if (!rules.auto_dismiss_review)"));
    expect(beforeGate).toContain("archiveReviewInsideLeadTime");
  });
});
