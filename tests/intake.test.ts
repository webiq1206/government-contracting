import { describe, it, expect } from "vitest";
import {
  deadlineStatus,
  intakeChecks,
  intakeVerdict,
  normalizeRules,
  DEFAULT_RULES,
  type AutomationRules,
} from "@/lib/domain/intake";

const NOW = new Date("2026-08-06T12:00:00Z");

function daysFromNow(d: number): string {
  return new Date(NOW.getTime() + d * 86_400_000).toISOString();
}

function rules(overrides: Partial<AutomationRules> = {}): AutomationRules {
  return { ...DEFAULT_RULES, ...overrides };
}

describe("normalizeRules", () => {
  it("returns defaults for empty/nullish input", () => {
    expect(normalizeRules(null)).toEqual(DEFAULT_RULES);
    expect(normalizeRules({})).toEqual(DEFAULT_RULES);
  });

  it("clamps negatives and junk to sane values", () => {
    const r = normalizeRules({
      min_lead_days: -5,
      approaching_days: Number.NaN,
      urgent_days: 0,
      retention_days: "soon" as unknown as number,
    });
    expect(r.min_lead_days).toBe(0);
    expect(r.approaching_days).toBe(DEFAULT_RULES.approaching_days);
    expect(r.urgent_days).toBe(1); // min 1
    expect(r.retention_days).toBe(DEFAULT_RULES.retention_days); // 30 days default
  });

  it("keeps urgent inside approaching", () => {
    const r = normalizeRules({ approaching_days: 5, urgent_days: 9 });
    expect(r.urgent_days).toBe(5);
  });

  it("only accepts known lead actions", () => {
    expect(normalizeRules({ lead_action: "dismiss" }).lead_action).toBe("dismiss");
    expect(normalizeRules({ lead_action: "explode" as never }).lead_action).toBe("review");
  });
});

describe("deadlineStatus", () => {
  it("handles missing deadlines", () => {
    const s = deadlineStatus(null, NOW);
    expect(s.key).toBe("none");
    expect(s.daysRemaining).toBeNull();
  });

  it("classifies by configurable thresholds", () => {
    expect(deadlineStatus(daysFromNow(30), NOW).key).toBe("normal");
    expect(deadlineStatus(daysFromNow(5), NOW).key).toBe("approaching"); // < 7
    expect(deadlineStatus(daysFromNow(2), NOW).key).toBe("urgent"); // < 3
    expect(deadlineStatus(daysFromNow(-1), NOW).key).toBe("past_due");
  });

  it("respects custom thresholds", () => {
    const r = rules({ approaching_days: 14, urgent_days: 10 });
    expect(deadlineStatus(daysFromNow(12), NOW, r).key).toBe("approaching");
    expect(deadlineStatus(daysFromNow(9), NOW, r).key).toBe("urgent");
  });

  it("always includes a written label and day count", () => {
    const s = deadlineStatus(daysFromNow(2), NOW);
    expect(s.label).toMatch(/urgent/i);
    expect(s.daysRemaining).toBe(2);
    expect(deadlineStatus(daysFromNow(0.5), NOW).label).toMatch(/due today/i);
  });
});

describe("intakeChecks", () => {
  it("passes a clean opportunity with ample time", () => {
    const findings = intakeChecks({
      deadline: daysFromNow(30),
      duplicateSolicitationCount: 0,
      rules: rules({ min_lead_days: 10 }),
      now: NOW,
    });
    expect(findings).toEqual([]);
    expect(intakeVerdict(findings)).toBe("proceed");
  });

  it("flags a missing deadline for review", () => {
    const findings = intakeChecks({
      deadline: null,
      duplicateSolicitationCount: 0,
      rules: rules(),
      now: NOW,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("missing_deadline");
    expect(findings[0].verdict).toBe("review");
    expect(intakeVerdict(findings)).toBe("review");
  });

  it("applies the minimum lead-time rule with the configured action", () => {
    const base = {
      deadline: daysFromNow(4),
      duplicateSolicitationCount: 0,
      now: NOW,
    };
    const review = intakeChecks({ ...base, rules: rules({ min_lead_days: 10 }) });
    expect(review[0].rule).toBe("min_lead_time");
    expect(review[0].verdict).toBe("review");
    expect(review[0].explanation).toContain("4 day(s) away");
    expect(review[0].explanation).toContain("10 days");

    const dismiss = intakeChecks({
      ...base,
      rules: rules({ min_lead_days: 10, lead_action: "dismiss" }),
    });
    expect(dismiss[0].verdict).toBe("dismiss");
    expect(intakeVerdict(dismiss)).toBe("dismiss");
  });

  it("does not apply lead time when disabled (0 days)", () => {
    const findings = intakeChecks({
      deadline: daysFromNow(1),
      duplicateSolicitationCount: 0,
      rules: rules({ min_lead_days: 0 }),
      now: NOW,
    });
    expect(findings).toEqual([]);
  });

  it("flags duplicate solicitation numbers for review", () => {
    const findings = intakeChecks({
      deadline: daysFromNow(30),
      duplicateSolicitationCount: 1,
      rules: rules(),
      now: NOW,
    });
    expect(findings[0].rule).toBe("duplicate_solicitation");
    expect(findings[0].verdict).toBe("review");
  });

  it("dismiss wins over review when both fire", () => {
    const findings = intakeChecks({
      deadline: daysFromNow(2),
      duplicateSolicitationCount: 2,
      rules: rules({ min_lead_days: 10, lead_action: "dismiss" }),
      now: NOW,
    });
    expect(findings).toHaveLength(2);
    expect(intakeVerdict(findings)).toBe("dismiss");
  });
});
