import { describe, it, expect } from "vitest";
import { checkHardExclusions, applyWeightOverrides } from "@/lib/domain/scoring";
import { defaultCompanyProfile } from "@/lib/domain/default-profile";

/**
 * Hard exclusions auto-dismiss an opportunity outright, so a keyword scan is a
 * consequential instrument. Two failure directions, and they are not equal:
 * missing a real requirement leaves work in the pipeline for a human to
 * reject, which costs a moment; falsely matching one throws away a biddable
 * contract silently, and nobody ever learns it happened.
 */
const profile = defaultCompanyProfile({ legalName: "Test Co", email: "t@e.com" });
const opp = (description: string) => ({
  set_aside_type: "Total Small Business",
  value_estimated: 200_000,
  naics_code: "236220",
  deadline: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  title: "Roof replacement",
  description,
});
const excluded = (d: string) =>
  checkHardExclusions(opp(d) as never, profile).some((h) =>
    ["security_clearance", "licensed_professional"].includes(h)
  );

describe("clearance and licence exclusions read context", () => {
  it.each([
    "No security clearance is required for this contract.",
    "No secret clearance is needed.",
    "Offerors do not require an active clearance.",
    "This work does not require a professional engineer.",
    "Architect stamp not required.",
    "No PE stamp is required on these drawings.",
  ])("keeps an opportunity that says the requirement does NOT apply: %s", (d) => {
    // Solicitations say these constantly. Matching the bare phrase inside a
    // negated sentence dismissed ordinary, winnable work.
    expect(excluded(d)).toBe(false);
  });

  it.each([
    "Work will be inspected by the government's professional engineer.",
    "Drawings will be reviewed by a licensed architect employed by the agency.",
  ])("keeps an opportunity that merely mentions the role: %s", (d) => {
    // Someone else's engineer is not an obligation on the bidder.
    expect(excluded(d)).toBe(false);
  });

  it.each([
    "Security clearance required: Top Secret.",
    "Contractor must employ a licensed professional engineer.",
    "All drawings must carry a PE stamp.",
    "Personnel must hold an active clearance.",
    "A TS/SCI clearance is mandatory for all site personnel.",
  ])("still excludes a stated requirement: %s", (d) => {
    expect(excluded(d)).toBe(true);
  });
});

/**
 * The pursue and review thresholds assume a 100 point scale, so a reweighted
 * rubric must still total 100. If it does not, the thresholds quietly mean
 * something else and nothing anywhere reports a fault.
 */
describe("reweighting preserves the scale", () => {
  const dims = profile.scoring_rubric.dimensions.map((d) => ({
    key: d.key,
    label: d.label,
    max_points: d.max_points,
  }));
  const total = (w: Record<string, unknown> | null) =>
    applyWeightOverrides(dims, w).reduce((a, d) => a + d.max_points, 0);

  it("leaves the rubric alone when there are no weights", () => {
    expect(total(null)).toBe(100);
    expect(total({})).toBe(100);
  });

  it("still totals 100 after a lopsided reweighting", () => {
    expect(total({ naics_active: { weight: 40 } })).toBe(100);
    expect(total(Object.fromEntries(dims.map((d) => [d.key, { weight: 10 }])))).toBe(100);
  });

  it("ignores a weighting that sums to nothing", () => {
    // This collapsed a 100 point rubric to 10: every dimension floored to
    // zero and the largest-remainder pass could hand back only one point
    // each. Scores then sat far below a threshold that still assumed 100, so
    // every opportunity was dismissed and nothing looked broken.
    expect(total(Object.fromEntries(dims.map((d) => [d.key, { weight: 0 }])))).toBe(100);
    expect(total(Object.fromEntries(dims.map((d) => [d.key, { weight: -5 }])))).toBe(100);
  });
});
