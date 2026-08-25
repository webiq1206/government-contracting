/**
 * A score built on unknowns must not look like one built on a full reading.
 *
 * The audit found opportunities collecting points for contract value on
 * notices that publish no value, with the total still presented as a
 * confident figure. Federal notices very often publish no value, so this was
 * not an edge case -- it was most of them, and the number an operator was
 * asked to act on could not be distinguished from one derived from a
 * solicitation read cover to cover.
 */
import { describe, it, expect } from "vitest";
import {
  assessDataConfidence,
  capUnsupportedDimensions,
  type ScoreFacts,
} from "@/lib/domain/score-confidence";

const allKnown: ScoreFacts = {
  valueKnown: true,
  naicsKnown: true,
  setAsideKnown: true,
  deadlineKnown: true,
  locationKnown: true,
  scopeKnown: true,
  pastPerformanceKnown: true,
};

const nothingKnown: ScoreFacts = {
  valueKnown: false,
  naicsKnown: false,
  setAsideKnown: false,
  deadlineKnown: false,
  locationKnown: false,
  scopeKnown: false,
  pastPerformanceKnown: false,
};

const dim = (key: string, points: number, max: number) => ({
  key,
  label: key,
  points,
  max_points: max,
  reasoning: "model said so",
});

describe("assessDataConfidence", () => {
  it("is 100% when the notice answered everything", () => {
    const c = assessDataConfidence(allKnown);
    expect(c.percent).toBe(100);
    expect(c.level).toBe("high");
    expect(c.unknown).toEqual([]);
  });

  it("is 0% and low when the notice is a headline", () => {
    const c = assessDataConfidence(nothingKnown);
    expect(c.percent).toBe(0);
    expect(c.level).toBe("low");
    expect(c.summary).toMatch(/Read the solicitation before trusting the score/);
  });

  it("weights the scope of the work above everything else", () => {
    // Knowing the deadline and the state tells you nothing about whether you
    // can do the job; knowing the scope is most of the judgement.
    const scopeOnly = assessDataConfidence({ ...nothingKnown, scopeKnown: true });
    const theRest = assessDataConfidence({
      ...nothingKnown,
      deadlineKnown: true,
      locationKnown: true,
      setAsideKnown: true,
    });
    expect(scopeOnly.percent).toBeGreaterThan(theRest.percent);
  });

  it("names the missing facts, which is the operator's reading list", () => {
    const c = assessDataConfidence({ ...allKnown, valueKnown: false });
    expect(c.unknown).toEqual(["the contract value"]);
    expect(c.summary).toContain("the contract value");
  });

  it("treats a mostly-complete notice as medium, not high", () => {
    // A missing scope alone drops it below the bar, because the remaining
    // facts describe the paperwork rather than the work.
    const c = assessDataConfidence({ ...allKnown, scopeKnown: false });
    expect(c.level).toBe("medium");
  });
});

describe("capUnsupportedDimensions", () => {
  it("caps the value dimension when the notice publishes no value", () => {
    const { dims, capped } = capUnsupportedDimensions(
      [dim("value_in_band", 15, 15)],
      { ...allKnown, valueKnown: false }
    );
    expect(capped).toEqual(["value_in_band"]);
    expect(dims[0].points).toBe(7);
    expect(dims[0].reasoning).toMatch(/the contract value is not stated/);
    // The model's original reading is kept, not discarded: it is evidence
    // about what the model did, which is worth being able to read back.
    expect(dims[0].reasoning).toMatch(/model said so/);
  });

  it("does not zero it, because unknown is not failure", () => {
    /*
     * A hard zero is itself a claim -- "this fails on value" -- and would
     * push perfectly good notices under the dismiss threshold on a fact that
     * was never published. Half admits the uncertainty in both directions.
     */
    const { dims } = capUnsupportedDimensions([dim("value_in_band", 15, 15)], {
      ...allKnown,
      valueKnown: false,
    });
    expect(dims[0].points).toBeGreaterThan(0);
  });

  it("leaves a dimension alone when its fact IS known", () => {
    const { dims, capped } = capUnsupportedDimensions([dim("value_in_band", 15, 15)], allKnown);
    expect(capped).toEqual([]);
    expect(dims[0].points).toBe(15);
    expect(dims[0].reasoning).toBe("model said so");
  });

  it("leaves a modest score alone even when the fact is missing", () => {
    // Already at or under the ceiling: the model was appropriately cautious,
    // and rewriting its reasoning would be noise.
    const { dims, capped } = capUnsupportedDimensions([dim("value_in_band", 4, 15)], {
      ...allKnown,
      valueKnown: false,
    });
    expect(capped).toEqual([]);
    expect(dims[0].points).toBe(4);
  });

  it("does not touch dimensions that depend on no single fact", () => {
    const { dims, capped } = capUnsupportedDimensions(
      [dim("agency_pays_ontime", 2, 2), dim("sub_findability", 5, 5)],
      nothingKnown
    );
    expect(capped).toEqual([]);
    expect(dims.map((d) => d.points)).toEqual([2, 5]);
  });

  it("caps every unsupported dimension in one pass", () => {
    const { capped } = capUnsupportedDimensions(
      [
        dim("value_in_band", 15, 15),
        dim("naics_active", 20, 20),
        dim("deadline_runway", 5, 5),
        dim("pricing_comps", 10, 10),
      ],
      nothingKnown
    );
    expect(capped).toEqual(["value_in_band", "naics_active", "deadline_runway"]);
  });
});
