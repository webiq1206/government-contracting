import { describe, expect, it, vi } from "vitest";
import { eligibleForBandDecision } from "@/lib/domain/band-decision";
import { scoringRiskFlags } from "@/lib/domain/scoring-flags";

describe("50-69 band eligibility", () => {
  const defaults = { pursue_min_score: 70, review_min_score: 50 };

  it("includes a finished score inside the default review band", () => {
    expect(eligibleForBandDecision(50, defaults)).toBe(true);
    expect(eligibleForBandDecision(69, defaults)).toBe(true);
    expect(eligibleForBandDecision(70, defaults)).toBe(false);
    expect(eligibleForBandDecision(49, defaults)).toBe(false);
  });

  it("decides 50-69 even when pursue is raised, and leaves 70-89 to a person", () => {
    expect(eligibleForBandDecision(60, { pursue_min_score: 90, review_min_score: 10 })).toBe(true);
    expect(eligibleForBandDecision(75, { pursue_min_score: 90, review_min_score: 10 })).toBe(false);
  });
});

describe("incomplete scoring flag", () => {
  it("drops the flag only after a finished score", () => {
    const finished = scoringRiskFlags({
      existing: ["incomplete_scoring", "deadline_soon"],
      exclusions: [],
      flags: [],
      scoringIncomplete: false,
      preserveLifecycle: false,
      tier: "review",
    });
    expect(finished).not.toContain("incomplete_scoring");
    expect(finished).toContain("deadline_soon");

    const stillOpen = scoringRiskFlags({
      existing: ["incomplete_scoring"],
      exclusions: [],
      flags: ["incomplete_scoring"],
      scoringIncomplete: true,
      preserveLifecycle: false,
      tier: "review",
    });
    expect(stillOpen).toContain("incomplete_scoring");
  });
});

vi.mock("@/lib/ai/claude", () => ({
  completeJson: vi.fn(async () => ({
    data: {
      decision: "pursue",
      reasons: ["The notice NAICS matches the company and the deadline is still weeks away."],
      fit_criteria_checked: ["naics", "geography", "deadline"],
    },
    usage: null,
  })),
}));

describe("band decision persistence", () => {
  it("keeps a stated reason and rejects an empty one", async () => {
    const { decideReviewBand } = await import("@/lib/ai/band-decision");
    const input = {
      title: "Dining facility attendant services, Dyess AFB",
      score: 62,
      summary: "Recorded score 62. Food service is in the company trades.",
      deadline: "2026-11-20T00:00:00.000Z",
      notice: { naics: "722310", setAside: "SDVOSB", place: "Abilene, TX", value: 250000 },
      company: {
        naics: ["722310"],
        serviceAreas: ["TX"],
        smallBusiness: true,
        certifications: ["SDVOSB"],
        annualRevenue: 4000000,
      },
    };
    const decision = await decideReviewBand(input);
    expect(decision?.choice).toBe("pursue");
    expect(decision?.fitCriteriaChecked).toEqual(["naics", "geography", "deadline"]);
    expect(decision?.reasoning).toContain("NAICS");

    const claude = await import("@/lib/ai/claude");
    vi.mocked(claude.completeJson).mockResolvedValueOnce({
      data: { decision: "pass", reasons: ["too thin"], fit_criteria_checked: ["naics"] },
      usage: null,
    } as never);
    await expect(decideReviewBand({ ...input, title: "Untitled", score: 55, summary: "Weak fit.", deadline: null })).resolves.toBeNull();
    vi.mocked(claude.completeJson).mockRejectedValueOnce(new Error("provider refused"));
    await expect(decideReviewBand(input)).resolves.toBeNull();
  });
});
