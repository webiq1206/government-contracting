import { describe, it, expect } from "vitest";
import { DEFAULT_RULES, normalizeRules, ruleConflicts } from "@/lib/domain/intake";

describe("normalizeRules, new outreach and call rules", () => {
  it("defaults reproduce exactly what the code used to hardcode", () => {
    const r = normalizeRules(null);
    expect(r.followup_hours).toBe(48);
    expect(r.followup_max).toBe(1);
    expect(r.outreach_batch_limit).toBe(50);
    expect(r.call_hours_start).toBe(8);
    expect(r.call_hours_end).toBe(17);
    expect(r.call_max_attempts).toBe(3);
  });

  it("keeps a stored config written before these rules existed working", () => {
    const r = normalizeRules({ min_lead_days: 4, retention_days: 90 });
    expect(r.min_lead_days).toBe(4);
    expect(r.followup_hours).toBe(DEFAULT_RULES.followup_hours);
    expect(r.call_max_attempts).toBe(DEFAULT_RULES.call_max_attempts);
  });

  it("refuses a follow-up interval of nothing, which would be a loop rather than a follow-up", () => {
    expect(normalizeRules({ followup_hours: 0 }).followup_hours).toBe(1);
    expect(normalizeRules({ followup_hours: -20 }).followup_hours).toBe(1);
  });

  it("allows zero follow-ups, which is a real choice", () => {
    expect(normalizeRules({ followup_max: 0 }).followup_max).toBe(0);
  });

  it("clamps a follow-up count nobody should be able to set", () => {
    expect(normalizeRules({ followup_max: 40 }).followup_max).toBe(5);
  });

  it("clamps calling hours into a real clock", () => {
    expect(normalizeRules({ call_hours_start: -3 }).call_hours_start).toBe(0);
    expect(normalizeRules({ call_hours_end: 99 }).call_hours_end).toBe(23);
  });

  it("collapses a backwards window rather than silently reversing it", () => {
    // Swapping would enforce hours nobody chose. One visibly-wrong hour gets
    // noticed and fixed; a quietly reversed window calls people at midnight.
    const r = normalizeRules({ call_hours_start: 17, call_hours_end: 8 });
    expect(r.call_hours_start).toBe(17);
    expect(r.call_hours_end).toBe(17);
  });

  it("rejects junk without throwing", () => {
    const r = normalizeRules({
      followup_hours: "soon" as unknown as number,
      call_max_attempts: null as unknown as number,
    });
    expect(r.followup_hours).toBe(48);
    expect(r.call_max_attempts).toBe(3);
  });

  it("treats an explicitly null key as absent, not as zero", () => {
    // null and "" both coerce to 0, and 0 means "no limit" for several of these
    // rules, so a null was quietly storing the most permissive setting there is.
    const r = normalizeRules({
      call_max_attempts: null as unknown as number,
      followup_max: "" as unknown as number,
      approaching_days: null as unknown as number,
    });
    expect(r.call_max_attempts).toBe(DEFAULT_RULES.call_max_attempts);
    expect(r.followup_max).toBe(DEFAULT_RULES.followup_max);
    expect(r.approaching_days).toBe(DEFAULT_RULES.approaching_days);
  });

  it("still honours a deliberate zero", () => {
    const r = normalizeRules({ call_max_attempts: 0, followup_max: 0, retention_days: 0 });
    expect(r.call_max_attempts).toBe(0);
    expect(r.followup_max).toBe(0);
    expect(r.retention_days).toBe(0);
  });
});

describe("ruleConflicts", () => {
  it("passes the defaults", () => {
    expect(ruleConflicts(DEFAULT_RULES)).toEqual([]);
  });

  it("catches a red warning that starts further out than the amber one", () => {
    const c = ruleConflicts({ ...DEFAULT_RULES, approaching_days: 3, urgent_days: 7 });
    expect(c[0].severity).toBe("error");
    expect(c[0].message).toContain("nothing would ever be amber");
  });

  it("catches a calling window that ends before it starts", () => {
    const c = ruleConflicts({ ...DEFAULT_RULES, call_hours_start: 17, call_hours_end: 8 });
    expect(c.some((x) => x.severity === "error" && x.message.includes("no hours at all"))).toBe(
      true
    );
  });

  it("warns about a calling window too narrow to get through the queue", () => {
    const c = ruleConflicts({ ...DEFAULT_RULES, call_hours_start: 9, call_hours_end: 10 });
    expect(c.some((x) => x.severity === "warning" && x.message.includes("under two hours"))).toBe(
      true
    );
  });

  it("warns when every accepted opportunity is already inside the amber window", () => {
    const c = ruleConflicts({ ...DEFAULT_RULES, min_lead_days: 3, approaching_days: 7 });
    expect(c.some((x) => x.message.includes("never mean anything"))).toBe(true);
  });

  it("warns when every follow-up lands within a day of the first email", () => {
    const c = ruleConflicts({ ...DEFAULT_RULES, followup_hours: 4, followup_max: 2 });
    expect(c.some((x) => x.message.includes("pestering"))).toBe(true);
  });

  it("does not warn about pestering when chasing is switched off", () => {
    const c = ruleConflicts({ ...DEFAULT_RULES, followup_hours: 1, followup_max: 0 });
    expect(c.some((x) => x.message.includes("pestering"))).toBe(false);
  });

  it("warns when history is deleted while the work it belongs to is still live", () => {
    const c = ruleConflicts({ ...DEFAULT_RULES, retention_days: 3, approaching_days: 7 });
    expect(c.some((x) => x.message.includes("history will disappear"))).toBe(true);
  });

  it("says call rules have nothing to apply to when calling is off", () => {
    const c = ruleConflicts({ ...DEFAULT_RULES, calls_enabled: false, call_max_attempts: 9 });
    expect(c.some((x) => x.message.includes("nothing to apply to"))).toBe(true);
  });

  it("stays quiet about call rules left at their defaults while calling is off", () => {
    const c = ruleConflicts({ ...DEFAULT_RULES, calls_enabled: false });
    expect(c.some((x) => x.message.includes("nothing to apply to"))).toBe(false);
  });
});
