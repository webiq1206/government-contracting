/**
 * The number behind the number.
 *
 * The roster showed reliability out of a hundred with nothing behind it. A
 * score nobody can explain is a score nobody can argue with, which sounds like
 * an advantage until an operator disagrees and has no way to check whether the
 * system or their memory is wrong.
 *
 * The property that matters most here is that the parts add up to the total.
 * A breakdown whose components do not sum to the number above them is worse
 * than no breakdown: it looks like an explanation and is a contradiction.
 */
import { describe, it, expect } from "vitest";
import {
  reliabilityBreakdown,
  responsivenessScore,
  isPreferred,
  type ReliabilityInputs,
} from "@/lib/domain/reliability";

function inputs(over: Partial<ReliabilityInputs> = {}): ReliabilityInputs {
  return {
    outreach: 0,
    respondedWithin48h: 0,
    respondedEver: 0,
    quotes: 0,
    blacklisted: false,
    ...over,
  };
}

describe("responsivenessScore", () => {
  it("says it is guessing when there is no outreach to measure", () => {
    const none = responsivenessScore(inputs());
    expect(none.assumed).toBe(true);
    const quotedButNeverEmailed = responsivenessScore(inputs({ quotes: 2 }));
    expect(quotedButNeverEmailed.assumed).toBe(true);
    expect(quotedButNeverEmailed.score).toBeGreaterThan(none.score);
  });

  it("weights an answer inside two days far above a late one", () => {
    /*
     * On a bid with a quote deadline, an answer next week is not an answer.
     */
    const fast = responsivenessScore(
      inputs({ outreach: 10, respondedWithin48h: 10, respondedEver: 10 })
    );
    const slow = responsivenessScore(
      inputs({ outreach: 10, respondedWithin48h: 0, respondedEver: 10 })
    );
    expect(fast.score).toBe(100);
    expect(slow.score).toBe(20);
    expect(fast.assumed).toBe(false);
  });

  it("is zero for a firm that never answers", () => {
    expect(responsivenessScore(inputs({ outreach: 8 })).score).toBe(0);
  });
});

describe("reliabilityBreakdown", () => {
  it("adds up to the score it prints", () => {
    for (const i of [
      inputs(),
      inputs({ outreach: 5, respondedWithin48h: 2, respondedEver: 4 }),
      inputs({ outreach: 5, respondedWithin48h: 5, respondedEver: 5, quotes: 3 }),
      inputs({ quotes: 1 }),
      inputs({ outreach: 20, respondedWithin48h: 1, respondedEver: 2, quotes: 1 }),
    ]) {
      const b = reliabilityBreakdown(i);
      const sum = b.components.reduce((t, c) => t + c.points, 0);
      expect(Math.min(100, sum)).toBe(b.reliability);
    }
  });

  it("reaches exactly 100 at the top and never has to clip", () => {
    /*
     * 30 on the roster + 40 for having quoted + 30 for perfect responsiveness
     * is 100 precisely. Nothing is ever cut off, which is what lets the
     * breakdown be read as arithmetic rather than as an approximation of it.
     */
    const b = reliabilityBreakdown(
      inputs({ outreach: 10, respondedWithin48h: 10, respondedEver: 10, quotes: 5 })
    );
    const sum = b.components.reduce((t, c) => t + c.points, 0);
    expect(sum).toBe(100);
    expect(b.reliability).toBe(100);
  });

  it("names a zero that is a decision rather than a measurement", () => {
    /*
     * A blocked firm scores zero because somebody blocked it, not because it
     * performed badly. Those read the same on a roster and are not the same.
     */
    const b = reliabilityBreakdown(inputs({ blacklisted: true, quotes: 4, outreach: 4, respondedEver: 4 }));
    expect(b.reliability).toBe(0);
    expect(b.caveat).toContain("decision somebody made");
    expect(b.components).toHaveLength(1);
  });

  it("makes the missing quote the loudest thing about a firm that has never priced", () => {
    const b = reliabilityBreakdown(inputs({ outreach: 6, respondedWithin48h: 6, respondedEver: 6 }));
    const quotePart = b.components.find((c) => c.label.includes("never quoted"));
    expect(quotePart?.points).toBe(0);
    expect(quotePart?.detail).toContain("largest single thing missing");
  });

  it("flags a responsiveness figure that is a placeholder", () => {
    const b = reliabilityBreakdown(inputs({ quotes: 1 }));
    expect(b.responsivenessIsAssumed).toBe(true);
    const part = b.components.find((c) => c.label.startsWith("Answers email"));
    expect(part?.detail).toContain("placeholder");
  });

  it("says what the score is not about", () => {
    const b = reliabilityBreakdown(inputs({ outreach: 4, respondedEver: 2, respondedWithin48h: 1 }));
    expect(b.caveat).toContain("not the quality of their work");
  });
});

describe("isPreferred", () => {
  it("needs both a quote and fast answers, and is never latched", () => {
    expect(isPreferred(inputs({ outreach: 4, respondedWithin48h: 4, respondedEver: 4, quotes: 2 }))).toBe(true);
    // Same firm, quotes removed: demoted, not stuck at preferred.
    expect(isPreferred(inputs({ outreach: 4, respondedWithin48h: 4, respondedEver: 4 }))).toBe(false);
  });

  it("never prefers a blocked firm", () => {
    expect(
      isPreferred(inputs({ blacklisted: true, outreach: 9, respondedWithin48h: 9, respondedEver: 9, quotes: 9 }))
    ).toBe(false);
  });
});
