/**
 * The case for and against one borderline opportunity.
 *
 * The recommendation has three outcomes rather than two, and the third is the
 * one that matters: a solicitation nobody could read properly does not deserve
 * a confident answer in either direction. Recommending a pass on thin data
 * teaches an operator that the system passes on whatever it does not
 * understand; recommending a pursue spends a day on a job that might not be
 * there.
 */
import { describe, it, expect } from "vitest";
import {
  buildReviewBrief,
  recommend,
  RECOMMENDATION_LABEL,
  type BriefInput,
  type ScoreDimension,
} from "@/lib/domain/review-brief";
import type { DataConfidence } from "@/lib/domain/score-confidence";

function dim(over: Partial<ScoreDimension> & { key: string }): ScoreDimension {
  return {
    label: over.key.replace(/_/g, " "),
    points: 5,
    max_points: 10,
    reasoning: "Because of the thing.",
    ...over,
  };
}

function confidence(level: DataConfidence["level"], unknown: string[] = []): DataConfidence {
  return {
    level,
    percent: level === "high" ? 90 : level === "medium" ? 60 : 25,
    known: [],
    unknown,
    summary: "",
  };
}

function input(over: Partial<BriefInput> = {}): BriefInput {
  return {
    score: 60,
    dimensions: [],
    riskFlags: [],
    confidence: confidence("high"),
    deadline: "2026-09-15T00:00:00Z",
    reviewExpiresAt: "2026-08-27T00:00:00Z",
    requiredTradeCount: 3,
    valueKnown: true,
    pastPerfClassification: null,
    ...over,
  };
}

describe("recommend", () => {
  it("passes on a blocker regardless of the score", () => {
    const r = recommend(input({ score: 69, riskFlags: ["prime_only"] }));
    expect(r.recommendation).toBe("pass");
    expect(r.rationale).toContain("regardless of how well it scores");
  });

  it("asks for a person when too little could be read", () => {
    /*
     * Not a pass. A pass here would train the operator that the system rejects
     * anything it cannot parse, and scanned PDFs are common.
     */
    const r = recommend(input({ score: 68, confidence: confidence("low") }));
    expect(r.recommendation).toBe("look");
    expect(r.rationale).toContain("could be read");
  });

  it("pursues at the top of the band with nothing blocking", () => {
    expect(recommend(input({ score: 67 })).recommendation).toBe("pursue");
  });

  it("passes low in the band with more than one risk", () => {
    expect(
      recommend(input({ score: 52, riskFlags: ["deadline_too_soon", "value_below_min"] }))
        .recommendation
    ).toBe("pass");
  });

  it("does not pass low in the band on a single risk", () => {
    expect(recommend(input({ score: 52, riskFlags: ["value_below_min"] })).recommendation).toBe(
      "look"
    );
  });

  it("labels every recommendation", () => {
    for (const k of ["pursue", "pass", "look"] as const) {
      expect(RECOMMENDATION_LABEL[k]).toBeTruthy();
    }
  });
});

describe("buildReviewBrief", () => {
  it("takes the three strongest dimensions as the positives", () => {
    const b = buildReviewBrief(
      input({
        dimensions: [
          dim({ key: "naics", points: 10, max_points: 10 }),
          dim({ key: "value", points: 8, max_points: 10 }),
          dim({ key: "location", points: 6, max_points: 10 }),
          dim({ key: "setaside", points: 5, max_points: 10 }),
          dim({ key: "past_perf", points: 1, max_points: 10 }),
        ],
      })
    );
    expect(b.positives.map((p) => p.label)).toEqual([
      "naics (10/10)",
      "value (8/10)",
      "location (6/10)",
    ]);
  });

  it("leaves positives empty rather than promoting a weak dimension", () => {
    const b = buildReviewBrief(
      input({ dimensions: [dim({ key: "a", points: 2, max_points: 10 })] })
    );
    expect(b.positives).toEqual([]);
  });

  it("ranks a flag above a merely weak dimension", () => {
    /*
     * A flag is something the system decided is wrong. A weak dimension is
     * something that did not help. One ranked list would put "scored 2 of 10
     * on location" above "set-aside you do not qualify for".
     */
    const b = buildReviewBrief(
      input({
        riskFlags: ["ineligible_set_aside"],
        dimensions: [dim({ key: "location", points: 1, max_points: 10 })],
      })
    );
    expect(b.risks[0].label).toBe("Set-aside you don't qualify for");
    expect(b.risks[1].label).toContain("Weak on location");
  });

  it("keeps risks to three", () => {
    const b = buildReviewBrief(
      input({
        riskFlags: ["a", "b", "c", "d", "e"],
        dimensions: [dim({ key: "x", points: 0, max_points: 10 })],
      })
    );
    expect(b.risks).toHaveLength(3);
  });

  it("carries the unreadable facts through as the reading list", () => {
    const b = buildReviewBrief(
      input({ confidence: confidence("medium", ["the contract value", "where the work is"]) })
    );
    expect(b.missing).toEqual(["the contract value", "where the work is"]);
  });

  it("says effort in work rather than in invented minutes", () => {
    const b = buildReviewBrief(input({ requiredTradeCount: 4, valueKnown: false }));
    expect(b.effort).toContain("4 trades to find and quote");
    expect(b.effort.some((e) => e.includes("comparable awards"))).toBe(true);
    expect(b.effort.join(" ")).not.toMatch(/\d+\s*(minute|hour)/i);
  });

  it("says the sourcing effort is unknown rather than showing no trades", () => {
    const b = buildReviewBrief(input({ requiredTradeCount: 0 }));
    expect(b.effort[0]).toContain("not identified yet");
    const nullCase = buildReviewBrief(input({ requiredTradeCount: null }));
    expect(nullCase.effort[0]).toContain("not identified yet");
  });

  it("keeps an unmeasured confidence distinct from a complete one", () => {
    /*
     * A null confidence is "nobody checked", not "nothing was missing". Both
     * produce an empty missing list, so the two have to be told apart by the
     * confidence itself rather than by the length of that list.
     */
    const unmeasured = buildReviewBrief(input({ confidence: null }));
    expect(unmeasured.confidence).toBeNull();
    expect(unmeasured.missing).toEqual([]);

    const measured = buildReviewBrief(input({ confidence: confidence("high", []) }));
    expect(measured.confidence).not.toBeNull();
    expect(measured.missing).toEqual([]);
  });

  it("does not recommend a look purely because confidence is unmeasured", () => {
    /*
     * Unmeasured is not low. Treating it as low would send every record
     * scored before confidence existed to a person, which is most of them.
     */
    expect(recommend(input({ score: 67, confidence: null })).recommendation).toBe("pursue");
  });

  it("carries the deadline and the auto-dismiss moment separately", () => {
    /*
     * They are different dates about different things: one is the government's
     * and one is ours, and conflating them is how somebody misses a bid
     * because a review timer expired.
     */
    const b = buildReviewBrief(input());
    expect(b.deadline).toBe("2026-09-15T00:00:00Z");
    expect(b.autoDismissAt).toBe("2026-08-27T00:00:00Z");
  });
});
