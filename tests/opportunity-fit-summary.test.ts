import { describe, expect, it } from "vitest";
import { buildMatchBadges } from "@/lib/domain/opportunity-fit-summary";
import type { ScoreBreakdown } from "@/lib/types";

const breakdown = (dimensions: ScoreBreakdown["dimensions"], exclusions: string[] = []): ScoreBreakdown => ({
  total: 10, tier: "dismiss", dimensions, hard_exclusions_triggered: exclusions, summary: "Recorded assessment",
});
const dim = (key: string, points: number) => ({ key, label: key, points, max_points: 10, reasoning: "Saved reasoning" });
describe("fit summary distinguishes a score from verified eligibility", () => {
  it("keeps missing scores and unknown value explicit", () => {
    const badges = buildMatchBadges({ breakdown: null, value: null, riskCount: 0 });
    expect(badges.map(b => b.label)).toEqual(["NAICS: no recorded score", "Service area: no recorded score", "Size fit: value unknown"]);
    expect(badges.every(b => b.tone === "neutral")).toBe(true);
  });
  it("never presents partial or full points as a passed criterion", () => {
    const badges = buildMatchBadges({ breakdown: breakdown([dim("naics", 5), dim("location", 0), dim("value_in_band", 10)], ["Outside service area"]), value: 100000, riskCount: 1 });
    expect(badges).toContainEqual({ label: "NAICS score: 5/10", tone: "neutral" });
    expect(badges).toContainEqual({ label: "Service area score: 0/10", tone: "risk" });
    expect(badges).toContainEqual({ label: "Size fit score: 10/10", tone: "neutral" });
    expect(badges).toContainEqual({ label: "1 exclusion recorded", tone: "risk" });
  });
  it("does not use a set-aside score as contract size evidence", () => {
    const badges = buildMatchBadges({ breakdown: breakdown([dim("sb_setaside_match", 10)]), value: null, riskCount: 0 });
    expect(badges).toContainEqual({ label: "Size fit: value unknown", tone: "neutral" });
    expect(buildMatchBadges({ breakdown: breakdown([dim("small_business_size", 10)]), value: 100000, riskCount: 0 })[2].label).toBe("Size fit: no recorded score");
  });
  it("does not use historical size points when the current value is unknown", () => {
    expect(buildMatchBadges({ breakdown: breakdown([dim("value_in_band", 10)]), value: null, riskCount: 0 })[2].label).toBe("Size fit: value unknown");
  });
  it("does not infer a category from a custom key or label", () => {
    const dimensions = [{ ...dim("custom_value_assessment", 10), label: "Trade and location business size value" }];
    expect(buildMatchBadges({ breakdown: breakdown(dimensions), value: 100000, riskCount: 0 }).map(b => b.label))
      .toEqual(["NAICS: no recorded score", "Service area: no recorded score", "Size fit: no recorded score"]);
  });
});
