import { describe, it, expect } from "vitest";
import { checkEligibility } from "../lib/domain/eligibility";
import type { CompanyProfileJson, SolicitationAnalysis } from "../lib/types";

function profile(over: Partial<CompanyProfileJson>): CompanyProfileJson {
  return {
    legal_name: "Acme",
    small_business: true,
    certifications: [],
    naics_codes: [],
    primary_trades: [],
    service_areas: [],
    target_margin_pct: 20,
    min_margin_pct: 10,
    max_markup_pct: 40,
    scoring_rubric: { dimensions: [], total_points: 100 } as never,
    hard_exclusions: [] as never,
    sub_standards: {} as never,
    pricing_rules: {} as never,
    decision_thresholds: {} as never,
    ...over,
  };
}

const analysis = (over: Partial<SolicitationAnalysis> = {}): SolicitationAnalysis =>
  ({ set_aside: null, qualifications: {}, ...over }) as SolicitationAnalysis;

describe("checkEligibility", () => {
  it("blocks a SDVOSB set-aside when the cert is missing", () => {
    const f = checkEligibility({
      profile: profile({ certifications: ["HUBZone"] }),
      opp: { naics_code: null, value_estimated: null, set_aside_type: "SDVOSB Set-Aside" },
      analysis: analysis(),
    });
    expect(f.some((x) => x.id === "elig_setaside_sdvosb" && x.severity === "blocker")).toBe(true);
  });

  it("passes a SDVOSB set-aside when the cert is held", () => {
    const f = checkEligibility({
      profile: profile({ certifications: ["SDVOSB"] }),
      opp: { naics_code: null, value_estimated: null, set_aside_type: "Service-Disabled Veteran-Owned" },
      analysis: analysis(),
    });
    expect(f.some((x) => x.id.startsWith("elig_setaside"))).toBe(false);
  });

  it("blocks a small-business set-aside for a non-small business", () => {
    const f = checkEligibility({
      profile: profile({ small_business: false }),
      opp: { naics_code: null, value_estimated: null, set_aside_type: "Total Small Business" },
      analysis: analysis(),
    });
    expect(f.some((x) => x.id === "elig_small_business" && x.severity === "blocker")).toBe(true);
  });

  it("warns on NAICS mismatch and bonding shortfall", () => {
    const f = checkEligibility({
      profile: profile({ naics_codes: ["236220"], bonding_capacity: 100000, uei: "X", cage_code: "Y" }),
      opp: { naics_code: "238160", value_estimated: 500000, set_aside_type: null },
      analysis: analysis({ qualifications: { bonding: ["Payment & performance bond required"] } }),
    });
    expect(f.some((x) => x.id === "elig_naics" && x.severity === "warning")).toBe(true);
    expect(f.some((x) => x.id === "elig_bonding" && x.severity === "warning")).toBe(true);
  });

  it("warns when no SAM identifiers are on file", () => {
    const f = checkEligibility({
      profile: profile({}),
      opp: { naics_code: null, value_estimated: null, set_aside_type: null },
      analysis: analysis(),
    });
    expect(f.some((x) => x.id === "elig_registration")).toBe(true);
  });
});
