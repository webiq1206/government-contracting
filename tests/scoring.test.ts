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

  it("hard exclusion: ineligible set-aside we don't hold", () => {
    const ex = checkHardExclusions(
      { set_aside_type: "8(a) Set-Aside", value_estimated: 100000, naics_code: "236220", deadline: null },
      DEFAULT_PROFILE
    );
    expect(ex).toContain("ineligible_set_aside");
  });

  it("hard exclusion: over bonding capacity (>150%)", () => {
    const ex = checkHardExclusions(
      { set_aside_type: null, value_estimated: 5_000_000, naics_code: "236220", deadline: null },
      DEFAULT_PROFILE
    );
    expect(ex).toContain("over_bonding");
  });

  it("hard exclusion: deadline under 48h", () => {
    const soon = new Date(Date.now() + 12 * 3600_000).toISOString();
    const ex = checkHardExclusions(
      { set_aside_type: null, value_estimated: 100000, naics_code: "236220", deadline: soon },
      DEFAULT_PROFILE
    );
    expect(ex).toContain("deadline_too_soon");
  });

  it("no exclusion for an eligible small-business set-aside", () => {
    const ex = checkHardExclusions(
      { set_aside_type: "Total Small Business Set-Aside", value_estimated: 250000, naics_code: "236220", deadline: null },
      DEFAULT_PROFILE
    );
    expect(ex).toHaveLength(0);
  });

  it("buildScoreBreakdown forces dismiss + zero when excluded", () => {
    const b = buildScoreBreakdown(
      [{ key: "naics_fit", label: "NAICS", points: 20, max_points: 20, reasoning: "" }],
      ["over_bonding"],
      DEFAULT_PROFILE,
      "excluded"
    );
    expect(b.tier).toBe("dismiss");
    expect(b.total).toBe(0);
    expect(b.hard_exclusions_triggered).toContain("over_bonding");
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
