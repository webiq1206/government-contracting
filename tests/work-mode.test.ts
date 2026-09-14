/**
 * Who does the work, and what that switches off.
 *
 * Pinned because these rules gate real sends: an opportunity marked
 * self-performed must never source or email a subcontractor, a mixed job
 * must only skip the scopes the company keeps, and the sentences shown
 * before somebody confirms must say plainly what stops and what does not.
 */
import { describe, it, expect } from "vitest";
import {
  effectiveWorkMode,
  outreachAllowed,
  tradeSelfPerformed,
  tradesNeedingSubs,
  outreachOffImpact,
  describeWorkMode,
  outreachAllowedSql,
  OUTREACH_JOBS,
  parseWorkMode,
} from "@/lib/domain/work-mode";
import { normalizeRules } from "@/lib/domain/intake";
import { summarizeTradeCoverage } from "@/lib/domain/trade-coverage";
import { stepSkipped } from "@/lib/domain/knowledge";

describe("effective mode", () => {
  it("inherits the company default until the record says otherwise", () => {
    expect(effectiveWorkMode("sub", { work_mode: null })).toBe("sub");
    expect(effectiveWorkMode("self", { work_mode: null })).toBe("self");
    expect(effectiveWorkMode("self", { work_mode: "sub" })).toBe("sub");
    expect(effectiveWorkMode("sub", { work_mode: "garbage" })).toBe("sub");
  });
  it("allows outreach for everything except self-performed", () => {
    expect(outreachAllowed("sub", null)).toBe(true);
    expect(outreachAllowed("mixed", null)).toBe(true);
    expect(outreachAllowed("self", null)).toBe(false);
    expect(outreachAllowed("sub", { work_mode: "self" })).toBe(false);
  });
  it("only accepts the three modes", () => {
    expect(parseWorkMode("self")).toBe("self");
    expect(parseWorkMode("owner")).toBeNull();
    expect(parseWorkMode(null)).toBeNull();
  });
});

describe("scopes", () => {
  it("treats every scope as in-house on a self-performed job and none on a subcontracted one", () => {
    expect(tradeSelfPerformed("self", [], "HVAC")).toBe(true);
    expect(tradeSelfPerformed("sub", ["HVAC"], "HVAC")).toBe(false);
  });
  it("matches mixed-job scopes loosely, so casing and punctuation do not create a second trade", () => {
    expect(tradeSelfPerformed("mixed", ["Hvac / mechanical"], "HVAC   Mechanical")).toBe(true);
    expect(tradeSelfPerformed("mixed", ["Electrical"], "Plumbing")).toBe(false);
    expect(tradesNeedingSubs("mixed", ["Electrical"], ["Electrical", "Plumbing", "Roofing"])).toEqual(["Plumbing", "Roofing"]);
  });
});

describe("what switching outreach off says", () => {
  it("names what stops and states that sent messages are not retracted", () => {
    const lines = outreachOffImpact({ pendingCalls: 2, followUpsDue: 3, sentMessages: 5, subsPaired: 4 });
    expect(lines.join(" ")).toMatch(/2 prepared calls will be cleared/);
    expect(lines.join(" ")).toMatch(/3 scheduled follow-up emails will not be sent/);
    expect(lines.join(" ")).toMatch(/does not retract them/);
    expect(lines.join(" ")).toMatch(/Deadlines, documents, requirements and pricing are unaffected/);
  });
  it("says so when nothing is in motion", () => {
    expect(outreachOffImpact({ pendingCalls: 0, followUpsDue: 0, sentMessages: 0, subsPaired: 0 })[0]).toMatch(/nothing is stopped/);
  });
  it("describes the mode for the record page", () => {
    expect(describeWorkMode("self", true)).toMatch(/Company default/);
    expect(describeWorkMode("mixed", false, ["Roofing"])).toMatch(/self-perform Roofing/);
  });
});

describe("plumbing", () => {
  it("names the jobs that only make sense with outreach on", () => {
    for (const j of ["sub-finder", "sub-verify", "outreach", "call-prep"]) expect(OUTREACH_JOBS.has(j)).toBe(true);
    expect(OUTREACH_JOBS.has("scoring-engine")).toBe(false);
    expect(OUTREACH_JOBS.has("pricing-research")).toBe(false);
  });
  it("builds the sweep predicate against the record's own override first", () => {
    expect(outreachAllowedSql("o", "$3")).toBe("coalesce(o.work_mode, $3) <> 'self'");
  });
  it("defaults the company rule to subcontracted, which is what every account had", () => {
    expect(normalizeRules(null).work_execution).toBe("sub");
    expect(normalizeRules({ work_execution: "self" }).work_execution).toBe("self");
    expect(normalizeRules({ work_execution: "nope" as never }).work_execution).toBe("sub");
  });
});

describe("downstream readers", () => {
  it("counts a self-performed scope as covered and priced by the company", () => {
    const c = summarizeTradeCoverage({
      requiredTrades: ["Roofing", "Electrical"],
      subs: [{ trade: "Electrical", outreach_state: "sent" }],
      quotes: [],
      workMode: "mixed",
      selfPerformedTrades: ["Roofing"],
    });
    const roofing = c.trades.find((t) => t.trade === "Roofing")!;
    expect(roofing.status).toBe("complete");
    expect(roofing.statusLabel).toMatch(/Self-performed/);
    expect(c.totals.uncovered).toBe(1);
  });
  it("hides the subcontractor steps from the help centre for a self-performed company", () => {
    const rules = normalizeRules({ work_execution: "self" });
    expect(stepSkipped({ key: "subs_found" } as never, rules)).toBe(true);
    expect(stepSkipped({ key: "emailed" } as never, rules)).toBe(true);
    expect(stepSkipped({ key: "quoted" } as never, rules)).toBe(false);
    expect(stepSkipped({ key: "subs_found" } as never, normalizeRules(null))).toBe(false);
  });
});
