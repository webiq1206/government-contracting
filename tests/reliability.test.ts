/**
 * The number behind the number.
 *
 * The roster showed reliability out of a hundred with nothing behind it. A
 * score nobody can explain is a score nobody can argue with, which sounds like
 * an advantage until an operator disagrees and has no way to check whether the
 * system or their memory is wrong.
 *
 * The property these tests exist to protect is that an unmeasured dimension
 * scores nothing rather than a placeholder, and that a firm with no history at
 * all has no score rather than a low one. A roster is sorted by this column,
 * and a made-up 50 puts a stranger above a firm that walked off a job.
 */
import { describe, it, expect } from "vitest";
import {
  EVIDENCE_LABEL,
  RELIABILITY_DIMENSIONS,
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

/** A firm with enough history for the score to be a score. */
function established(over: Partial<ReliabilityInputs> = {}): ReliabilityInputs {
  return inputs({
    outreach: 10,
    respondedWithin48h: 10,
    respondedEver: 10,
    quotes: 5,
    ...over,
  });
}

describe("responsivenessScore", () => {
  it("is null when nobody has emailed them", () => {
    // Not 50. A firm added this morning has not scored badly at answering
    // email; nobody has sent them any.
    expect(responsivenessScore(inputs())).toBeNull();
    expect(responsivenessScore(inputs({ quotes: 2 }))).toBeNull();
  });

  it("weights an answer inside two days far above a late one", () => {
    // On a bid with a quote deadline, an answer next week is not an answer.
    expect(
      responsivenessScore(inputs({ outreach: 10, respondedWithin48h: 10, respondedEver: 10 }))
    ).toBe(100);
    expect(
      responsivenessScore(inputs({ outreach: 10, respondedWithin48h: 0, respondedEver: 10 }))
    ).toBe(20);
  });

  it("is zero for a firm that never answers", () => {
    // Zero here is a measurement: eight went out and none came back.
    expect(responsivenessScore(inputs({ outreach: 8 }))).toBe(0);
  });
});

describe("reliabilityBreakdown", () => {
  it("has no score for a firm nothing is known about", () => {
    const b = reliabilityBreakdown(inputs());
    expect(b.reliability).toBeNull();
    expect(b.evidence).toBe("none");
    expect(b.measured).toEqual([]);
    expect(b.caveat).toContain("not the same as a bad one");
  });

  it("always reports all six dimensions, measured or not", () => {
    /*
     * A breakdown that lists only what it measured reads as a complete
     * account. The gaps are the most useful thing on it: they say what to go
     * and find out.
     */
    const b = reliabilityBreakdown(inputs());
    expect(b.dimensions.map((d) => d.key)).toEqual([...RELIABILITY_DIMENSIONS]);
    expect(b.dimensions.every((d) => d.score == null)).toBe(true);
  });

  it("does not blame a firm for not quoting when nobody asked", () => {
    const never = reliabilityBreakdown(inputs());
    const asked = reliabilityBreakdown(inputs({ outreach: 3 }));
    expect(never.dimensions.find((d) => d.key === "quoting")?.score).toBeNull();
    // Asked three times and gave nothing: now it is a fact about them.
    expect(asked.dimensions.find((d) => d.key === "quoting")?.score).toBe(0);
  });

  it("rescales over what was measured, so a short history is not a ceiling", () => {
    /*
     * A firm that answers every email and always quotes reaches 100 without
     * ever having been given work. Holding it to 45 because three dimensions
     * have no data would make the number a measure of how long we have known
     * them.
     */
    const b = reliabilityBreakdown(established());
    expect(b.reliability).toBe(100);
    expect(b.unmeasured).toContain("performance");
  });

  it("counts a bad job against a firm that has been given work", () => {
    const clean = reliabilityBreakdown(established({ jobsCompleted: 4, jobsWithIssues: 0 }));
    const messy = reliabilityBreakdown(established({ jobsCompleted: 4, jobsWithIssues: 3 }));
    expect(clean.reliability).toBe(100);
    expect(messy.reliability!).toBeLessThan(clean.reliability!);
    expect(messy.measured).toContain("performance");
  });

  it("takes cancellations off the total rather than averaging them away", () => {
    /*
     * A firm that walked off two committed jobs does not deserve to have that
     * cancelled out by a good email habit. Averaging is exactly what would
     * happen if this were a weighted dimension like the others.
     */
    const none = reliabilityBreakdown(established());
    const one = reliabilityBreakdown(established({ cancellations: 1 }));
    const two = reliabilityBreakdown(established({ cancellations: 2 }));
    expect(one.reliability).toBe(none.reliability! - 15);
    expect(two.reliability).toBe(none.reliability! - 30);
  });

  it("caps the cancellation deduction rather than going negative", () => {
    const many = reliabilityBreakdown(established({ cancellations: 20 }));
    expect(many.reliability).toBeGreaterThanOrEqual(0);
    expect(many.reliability).toBe(55);
  });

  it("judges lateness only against a date the firm was actually given", () => {
    const noDates = reliabilityBreakdown(established());
    expect(noDates.dimensions.find((d) => d.key === "timeliness")?.score).toBeNull();

    const late = reliabilityBreakdown(established({ quotesWithDeadline: 4, quotesOnTime: 1 }));
    expect(late.dimensions.find((d) => d.key === "timeliness")?.score).toBe(25);
    expect(late.reliability!).toBeLessThan(noDates.reliability!);
  });

  it("judges scope only on quotes somebody actually checked", () => {
    const unchecked = reliabilityBreakdown(established());
    expect(unchecked.dimensions.find((d) => d.key === "scope")?.score).toBeNull();

    const partial = reliabilityBreakdown(established({ quotesScopeJudged: 4, quotesFullScope: 2 }));
    expect(partial.dimensions.find((d) => d.key === "scope")?.score).toBe(50);
  });

  it("names a zero that is a decision rather than a measurement", () => {
    // A blocked firm scores zero because somebody blocked it, not because it
    // performed badly. Those read the same on a roster and are not the same.
    const b = reliabilityBreakdown(
      inputs({ blacklisted: true, quotes: 4, outreach: 4, respondedEver: 4 })
    );
    expect(b.reliability).toBe(0);
    expect(b.caveat).toContain("decision somebody made");
  });

  it("says how much the number rests on", () => {
    expect(reliabilityBreakdown(inputs()).evidence).toBe("none");
    expect(reliabilityBreakdown(inputs({ outreach: 2 })).evidence).toBe("thin");
    expect(reliabilityBreakdown(inputs({ outreach: 5 })).evidence).toBe("some");
    expect(reliabilityBreakdown(established()).evidence).toBe("solid");
    for (const level of ["none", "thin", "some", "solid"] as const) {
      expect(EVIDENCE_LABEL[level]).toBeTruthy();
    }
  });

  it("warns when a high score rests on one dealing", () => {
    const b = reliabilityBreakdown(inputs({ outreach: 1, respondedWithin48h: 1, respondedEver: 1 }));
    expect(b.caveat).toContain("first impression");
  });
});

describe("isPreferred", () => {
  it("needs a high score and a real history", () => {
    expect(isPreferred(established())).toBe(true);
    // Same quality, one dealing. A stranger who answered one email is not a
    // preferred subcontractor.
    expect(
      isPreferred(inputs({ outreach: 1, respondedWithin48h: 1, respondedEver: 1 }))
    ).toBe(false);
  });

  it("is never latched", () => {
    // Quotes removed: demoted, not stuck at preferred.
    expect(isPreferred(established({ quotes: 0 }))).toBe(false);
  });

  it("never prefers a blocked firm", () => {
    expect(isPreferred(established({ blacklisted: true }))).toBe(false);
  });

  it("never prefers a firm nothing is known about", () => {
    expect(isPreferred(inputs())).toBe(false);
  });
});
