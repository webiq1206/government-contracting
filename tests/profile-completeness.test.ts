/**
 * What the profile percentage is allowed to claim.
 *
 * The profile is read by scoring, eligibility, every generated document and
 * every subcontractor email. A missing field there fails quietly: a lower
 * score, a thinner bid, an email with a gap in it, none of which point back at
 * the empty box. The percentage exists to point.
 */
import { describe, it, expect } from "vitest";
import {
  assessProfile,
  PROFILE_SECTIONS,
  type ProfileSectionKey,
} from "../lib/domain/profile-completeness";
import type { CompanyProfileJson } from "../lib/types";

function profile(over: Partial<CompanyProfileJson> = {}): CompanyProfileJson {
  return {
    legal_name: "",
    small_business: true,
    certifications: [],
    naics_codes: [],
    primary_trades: [],
    service_areas: [],
    target_margin_pct: 15,
    min_margin_pct: 8,
    max_markup_pct: 30,
    scoring_rubric: { total_points: 100, dimensions: [] },
    hard_exclusions: [],
    sub_standards: { require_active_license: true, require_not_sam_excluded: true },
    pricing_rules: {} as CompanyProfileJson["pricing_rules"],
    decision_thresholds: {} as CompanyProfileJson["decision_thresholds"],
    ...over,
  };
}

const section = (p: CompanyProfileJson, key: ProfileSectionKey) =>
  assessProfile(p).sections.find((s) => s.key === key)!;

describe("the eight sections the audit names", () => {
  it("has all of them, in order", () => {
    expect(PROFILE_SECTIONS.map((s) => s.key)).toEqual([
      "identity",
      "eligibility",
      "target_work",
      "service_areas",
      "pricing",
      "sub_standards",
      "exclusions",
      "standing_instructions",
    ]);
  });

  it("gives every field a consequence rather than a label", () => {
    /*
     * "Field incomplete" is not actionable. "Nothing is found: the feed is
     * filtered by these before anything is scored" is.
     */
    for (const s of PROFILE_SECTIONS) {
      for (const f of s.fields) {
        expect(f.consequence.length, `${s.key}.${f.key} has no consequence`).toBeGreaterThan(20);
      }
    }
  });
});

describe("assessProfile", () => {
  it("survives a profile older than the fields it checks", () => {
    // A profile written before a field existed reads as empty, not as a crash
    // that takes the whole settings page with it.
    expect(() => assessProfile({} as CompanyProfileJson)).not.toThrow();
    expect(() => assessProfile(null)).not.toThrow();
    expect(assessProfile(null).percent).toBeLessThan(100);
  });

  it("weights by what a field costs, not by how many there are", () => {
    /*
     * A profile with a legal name and nothing else must not read the same as
     * one with a pricing note and nothing else. The first can produce a bid.
     */
    const named = assessProfile(profile({ legal_name: "Brost Co" })).percent;
    const noted = assessProfile(profile({ pricing_philosophy: "We bid tight." })).percent;
    expect(named).toBeGreaterThan(noted);
  });

  it("counts a false boolean as answered", () => {
    // "We are not a small business" is a real answer, and treating it as an
    // empty field would nag somebody forever for a fact they gave.
    const s = section(profile({ small_business: false }), "eligibility");
    expect(s.fields.find((f) => f.key === "small_business")?.filled).toBe(true);
  });

  it("gives an invalid value no credit at all", () => {
    /*
     * A UEI of the wrong length is worse than a blank one: it looks filled in
     * and the bid carrying it is rejected by the portal rather than here.
     */
    const good = assessProfile(profile({ uei: "ABC123DEF456" }));
    const bad = assessProfile(profile({ uei: "TOO-SHORT" }));
    expect(bad.percent).toBeLessThan(good.percent);
    expect(bad.invalid.map((f) => f.key)).toContain("uei");
    expect(bad.invalid[0].message).toContain("twelve");
  });

  it("catches a floor set above the target", () => {
    // Not a typo the platform can resolve: every bid would break its own
    // floor, and the Bid Builder would have to pick one rule to ignore.
    const s = section(profile({ min_margin_pct: 25, target_margin_pct: 15 }), "pricing");
    expect(s.invalid.map((f) => f.key)).toContain("min_margin_pct");
  });

  it("names what stops working, not that a field is empty", () => {
    const s = section(profile(), "target_work");
    const naics = s.fields.find((f) => f.key === "naics_codes")!;
    expect(naics.filled).toBe(false);
    expect(naics.message).toContain("Nothing is found");
  });

  it("puts the most expensive gaps first", () => {
    const next = assessProfile(profile()).nextUp;
    expect(next.length).toBeGreaterThan(0);
    // Sorted worst first, so the list is a work order rather than an inventory.
    for (let i = 1; i < next.length; i++) {
      expect(next[i - 1].weight).toBeGreaterThanOrEqual(next[i].weight);
    }
  });

  it("reaches a hundred only when everything real is answered", () => {
    const full = profile({
      legal_name: "Brost Co",
      uei: "ABC123DEF456",
      cage_code: "1A2B3",
      owner_name: "Dana Brost",
      outreach_email: "bids@example.invalid",
      phone: "555-0100",
      physical_address: "1 Main St",
      entity_state: "TX",
      years_in_business: 9,
      bonding_capacity: 2_000_000,
      certifications: ["SDVOSB"],
      naics_codes: ["238160"],
      psc_codes: ["Z1AA"],
      primary_trades: ["Roofing"],
      service_areas: ["TX"],
      pricing_philosophy: "We bid tight.",
      hard_exclusions: [{ key: "x", label: "No asbestos", rule: "never" }],
      excluded_naics: ["111110"],
      notes: "Call before nine.",
      legal_guardrails: ["No indemnity beyond insured limits."],
      sub_standards: {
        require_active_license: true,
        require_not_sam_excluded: true,
        min_reviews: 5,
      },
    });
    expect(assessProfile(full).percent).toBe(100);
    expect(assessProfile(full).invalid).toEqual([]);
  });
});
