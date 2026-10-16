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

  it("leaves a raised pursue threshold to a person", () => {
    // The isolation fixture pursues at 90, so a 60 must stay in review.
    expect(eligibleForBandDecision(60, { pursue_min_score: 90, review_min_score: 10 })).toBe(false);
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
      reasoning: "The notice matches a trade the company performs and the deadline is still weeks away.",
    },
    usage: null,
  })),
}));

describe("band decision persistence", () => {
  it("keeps a stated reason and rejects an empty one", async () => {
    const { decideReviewBand } = await import("@/lib/ai/band-decision");
    const decision = await decideReviewBand({
      title: "Dining facility attendant services, Dyess AFB",
      score: 62,
      summary: "Recorded score 62. Food service is in the company trades.",
      deadline: "2026-11-20T00:00:00.000Z",
    });
    expect(decision).toEqual({
      choice: "pursue",
      reasoning: "The notice matches a trade the company performs and the deadline is still weeks away.",
    });

    const claude = await import("@/lib/ai/claude");
    vi.mocked(claude.completeJson).mockResolvedValueOnce({
      data: { decision: "pass", reasoning: "too thin" },
      usage: null,
    } as never);
    await expect(decideReviewBand({
      title: "Untitled",
      score: 55,
      summary: "Weak fit.",
      deadline: null,
    })).resolves.toBeNull();
  });
});
