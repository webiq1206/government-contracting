import { describe, it, expect } from "vitest";
import {
  assignTier,
  sumDimensions,
  checkHardExclusions,
  buildScoreBreakdown,
  clamp,
} from "@/lib/domain/scoring";
import { DEFAULT_PROFILE } from "@/db/seedData";

const thresholds = DEFAULT_PROFILE.decision_thresholds;

describe("scoring", () => {
  it("assigns tier from thresholds", () => {
    expect(assignTier(85, thresholds)).toBe("pursue");
    expect(assignTier(70, thresholds)).toBe("pursue");
    expect(assignTier(60, thresholds)).toBe("review");
    expect(assignTier(50, thresholds)).toBe("review");
    expect(assignTier(49, thresholds)).toBe("dismiss");
  });

  it("clamps dimension points to their max", () => {
    expect(clamp(30, 0, 20)).toBe(20);
    expect(clamp(-5, 0, 20)).toBe(0);
  });

  it("sums dimensions clamped to max", () => {
    const total = sumDimensions([
      { key: "a", label: "A", points: 25, max_points: 20, reasoning: "" },
      { key: "b", label: "B", points: 10, max_points: 15, reasoning: "" },
    ]);
    expect(total).toBe(30); // 20 (clamped) + 10
  });

  const baseOpp = {
    set_aside_type: null as string | null,
    value_estimated: 200_000 as number | null,
    naics_code: "561730",
    deadline: null as string | null,
    title: "Grounds maintenance services",
    description: "Recurring landscaping and grounds maintenance for a federal facility.",
  };

  it("hard exclusion: ineligible set-aside we don't hold", () => {
    const ex = checkHardExclusions(
      { ...baseOpp, set_aside_type: "8(a) Set-Aside" },
      DEFAULT_PROFILE
    );
    expect(ex).toContain("ineligible_set_aside");
  });

  it("hard exclusion: value below the $50K minimum", () => {
    const ex = checkHardExclusions({ ...baseOpp, value_estimated: 30_000 }, DEFAULT_PROFILE);
    expect(ex).toContain("value_below_min");
  });

  it("hard exclusion: unrestricted contract under $150K", () => {
    const ex = checkHardExclusions(
      { ...baseOpp, set_aside_type: "Unrestricted", value_estimated: 90_000 },
      DEFAULT_PROFILE
    );
    expect(ex).toContain("unrestricted_under_threshold");
  });

  it("hard exclusion: security clearance keywords", () => {
    const ex = checkHardExclusions(
      { ...baseOpp, description: "Personnel must hold an active Top Secret / TS/SCI clearance." },
      DEFAULT_PROFILE
    );
    expect(ex).toContain("security_clearance");
  });

  it("hard exclusion: licensed professional stamp required", () => {
    const ex = checkHardExclusions(
      { ...baseOpp, description: "Deliverables require a professional engineer stamp." },
      DEFAULT_PROFILE
    );
    expect(ex).toContain("licensed_professional");
  });

  it("hard exclusion: deadline under 7 days", () => {
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const ex = checkHardExclusions({ ...baseOpp, deadline: soon }, DEFAULT_PROFILE);
    expect(ex).toContain("deadline_too_soon");
  });

  it("no exclusion for an eligible small-business set-aside in range", () => {
    const ex = checkHardExclusions(
      { ...baseOpp, set_aside_type: "Total Small Business Set-Aside", value_estimated: 250_000 },
      DEFAULT_PROFILE
    );
    expect(ex).toHaveLength(0);
  });

  it("buildScoreBreakdown forces dismiss + zero when excluded", () => {
    const b = buildScoreBreakdown(
      [{ key: "naics_active", label: "NAICS", points: 20, max_points: 20, reasoning: "" }],
      ["value_below_min"],
      DEFAULT_PROFILE,
      "excluded"
    );
    expect(b.tier).toBe("dismiss");
    expect(b.total).toBe(0);
    expect(b.hard_exclusions_triggered).toContain("value_below_min");
  });

  it("buildScoreBreakdown tiers a clean score", () => {
    const dims = DEFAULT_PROFILE.scoring_rubric.dimensions.map((d) => ({
      key: d.key,
      label: d.label,
      points: d.max_points, // perfect
      max_points: d.max_points,
      reasoning: "",
    }));
    const b = buildScoreBreakdown(dims, [], DEFAULT_PROFILE, "great");
    expect(b.total).toBe(100);
    expect(b.tier).toBe("pursue");
  });
});
