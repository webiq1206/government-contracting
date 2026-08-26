import { describe, it, expect } from "vitest";
import {
  thresholdImpact,
  thresholdProblems,
  describeImpact,
  type ScoreHistogram,
} from "@/lib/domain/scoring-impact";

/** Ten opportunities each at 30, 50, 65, 75 and 90. */
function hist(): ScoreHistogram {
  const h = new Array(101).fill(0);
  for (const s of [30, 50, 65, 75, 90]) h[s] = 10;
  return h;
}

const CURRENT = { pursue_min_score: 70, review_min_score: 50 };

describe("thresholdImpact", () => {
  it("counts the current split correctly", () => {
    const i = thresholdImpact(hist(), CURRENT, CURRENT);
    expect(i.before).toEqual({ pursue: 20, review: 20, dismiss: 10 });
    expect(i.total).toBe(50);
    expect(i.unchanged).toBe(true);
  });

  it("names what a lower pursue threshold would start running automatically", () => {
    const i = thresholdImpact(hist(), CURRENT, { ...CURRENT, pursue_min_score: 60 });
    // The ten at 65 cross from review into pursue.
    expect(i.intoPursue).toBe(10);
    expect(i.outOfPursue).toBe(0);
    expect(i.after.pursue).toBe(30);
    expect(i.unchanged).toBe(false);
  });

  it("names what a higher pursue threshold would stop running", () => {
    const i = thresholdImpact(hist(), CURRENT, { ...CURRENT, pursue_min_score: 80 });
    expect(i.outOfPursue).toBe(10);
    expect(i.intoReview).toBe(10);
    expect(i.intoPursue).toBe(0);
  });

  it("counts work that would stop being offered at all", () => {
    const i = thresholdImpact(hist(), CURRENT, { ...CURRENT, review_min_score: 60 });
    expect(i.intoDismiss).toBe(10);
    expect(i.after.dismiss).toBe(20);
  });

  it("counts dismissed work that would come back", () => {
    const i = thresholdImpact(hist(), CURRENT, { ...CURRENT, review_min_score: 20 });
    expect(i.outOfDismiss).toBe(10);
    expect(i.after.review).toBe(30);
  });

  it("says nothing moves when nothing moves", () => {
    // 71 and 70 both leave every score on the same side of every boundary here.
    const i = thresholdImpact(hist(), CURRENT, { ...CURRENT, pursue_min_score: 71 });
    expect(i.unchanged).toBe(true);
    expect(describeImpact(i)).toContain("Nothing moves");
  });

  it("handles an account with nothing scored without dividing by it", () => {
    const i = thresholdImpact(new Array(101).fill(0), CURRENT, {
      ...CURRENT,
      pursue_min_score: 10,
    });
    expect(i.total).toBe(0);
    expect(i.intoPursue).toBe(0);
    expect(describeImpact(i)).toContain("no scored opportunities on file");
  });

  it("uses the same tiering the scoring engine uses, boundaries included", () => {
    const h = new Array(101).fill(0);
    h[70] = 1; // exactly at the pursue threshold
    h[69] = 1;
    h[50] = 1; // exactly at the review floor
    h[49] = 1;
    const i = thresholdImpact(h, CURRENT, CURRENT);
    expect(i.before).toEqual({ pursue: 1, review: 2, dismiss: 1 });
  });
});

describe("describeImpact", () => {
  it("says outreach out loud when work would start running", () => {
    const i = thresholdImpact(hist(), CURRENT, { ...CURRENT, pursue_min_score: 60 });
    expect(describeImpact(i)).toContain("emailing subcontractors");
    expect(describeImpact(i)).toContain("Of 50 scored opportunities");
  });

  it("describes a review-band-only shuffle without claiming outreach", () => {
    const h = new Array(101).fill(0);
    h[55] = 4;
    const i = thresholdImpact(h, CURRENT, { ...CURRENT, review_min_score: 51 });
    expect(describeImpact(i)).toContain("Nothing moves");
  });
});

describe("thresholdProblems", () => {
  it("passes a sensible pair", () => {
    expect(thresholdProblems(CURRENT)).toEqual([]);
  });

  it("refuses a review floor at or above the pursue score", () => {
    const p = thresholdProblems({ pursue_min_score: 60, review_min_score: 60 });
    expect(p[0].severity).toBe("error");
    expect(p[0].message).toContain("below the auto-pursue score");
  });

  it("refuses scores outside 1 to 100", () => {
    expect(thresholdProblems({ pursue_min_score: 0, review_min_score: 0 }).some((p) => p.severity === "error")).toBe(true);
    expect(thresholdProblems({ pursue_min_score: 101, review_min_score: 50 })[0].severity).toBe("error");
  });

  it("refuses values that are not numbers at all", () => {
    const p = thresholdProblems({ pursue_min_score: NaN, review_min_score: 50 });
    expect(p).toHaveLength(1);
    expect(p[0].severity).toBe("error");
  });

  it("warns about, but permits, an aggressive auto-pursue score", () => {
    const p = thresholdProblems({ pursue_min_score: 30, review_min_score: 10 });
    expect(p.every((x) => x.severity === "warning")).toBe(true);
    expect(p.some((x) => x.message.includes("without anybody looking first"))).toBe(true);
  });

  it("warns about a review band wide enough to bury a person", () => {
    const p = thresholdProblems({ pursue_min_score: 95, review_min_score: 5 });
    expect(p.some((x) => x.message.includes("review band this wide"))).toBe(true);
  });
});
