import { describe, expect, it } from "vitest";
import {
  bidMath,
  explainBidMath,
  tradeCost,
  unknownSummary,
} from "../lib/domain/trade-pricing";
import { markupForTargetMargin } from "../lib/domain/pricing";

/**
 * A trade's price is not one number, and the parts of it go missing
 * separately.
 *
 * The rule here is the brief's: never show 0 for a value nobody knows.
 * `marginFromBid` returns 0 when the bid is zero, which is correct arithmetic
 * and a false statement about the world. An unpriced trade reading "0% margin"
 * looks like a thin job rather than an unanswered question, and a total that
 * treats a missing freight number as nothing is too low by exactly the amount
 * nobody has found out yet.
 */

describe("adding up one trade", () => {
  it("adds every component that was established", () => {
    const c = tradeCost({
      baseQuote: 100_000,
      taxes: 8_250,
      freight: 1_200,
      mobilization: 3_000,
      bonding: 2_000,
    });
    expect(c.total).toBe(114_450);
    expect(c.unknown).toEqual([]);
  });

  it("refuses to total anything when the base quote is unknown", () => {
    /*
     * Null is "nobody knows". Returning 8,250 here, the sum of the parts that
     * happen to be filled in, would be a number that looks like a price.
     */
    const c = tradeCost({ baseQuote: null, taxes: 8_250 });
    expect(c.total).toBeNull();
    expect(c.unknown).toEqual(["baseQuote"]);
  });

  it("treats an absent optional component as absent, not unknown", () => {
    /*
     * A trade with no freight is not a trade with unknown freight. Demanding a
     * zero in every box would turn the distinction this module protects into a
     * chore that gets clicked through.
     */
    const c = tradeCost({ baseQuote: 50_000 });
    expect(c.total).toBe(50_000);
    expect(c.unknown).toEqual([]);
  });

  it("keeps a deliberate zero as a zero", () => {
    // "We checked, there is no bonding on this one" is a fact, and it is not
    // the same as nobody having looked.
    const c = tradeCost({ baseQuote: 50_000, bonding: 0 });
    expect(c.total).toBe(50_000);
    expect(c.parts.some((p) => p.component === "bonding")).toBe(true);
  });

  it("applies a negative manual adjustment", () => {
    const c = tradeCost({
      baseQuote: 100_000,
      manualAdjustment: -5_000,
      manualAdjustmentReason: "Sub agreed to absorb the crane on a second visit.",
    });
    expect(c.total).toBe(95_000);
    expect(c.adjustmentUnexplained).toBe(false);
  });

  it("flags an adjustment nobody explained", () => {
    // A number an estimator cannot defend six weeks later is a number that
    // should not be sitting silently in a bid.
    const c = tradeCost({ baseQuote: 100_000, manualAdjustment: -5_000 });
    expect(c.adjustmentUnexplained).toBe(true);
  });

  it("does not flag a zero adjustment as unexplained", () => {
    expect(tradeCost({ baseQuote: 1, manualAdjustment: 0 }).adjustmentUnexplained).toBe(false);
  });

  it("treats a non-finite value as unknown rather than adding it", () => {
    const c = tradeCost({ baseQuote: Number.NaN });
    expect(c.total).toBeNull();
    expect(c.unknown).toContain("baseQuote");
  });
});

describe("margin and markup are different numbers", () => {
  it("computes both, from the same two figures", () => {
    // Cost 80,000, bid 100,000, profit 20,000.
    // Margin is 20,000/100,000 = 20%. Markup is 20,000/80,000 = 25%.
    const m = bidMath({ cost: 80_000, bid: 100_000 });
    expect(m.grossProfit).toBe(20_000);
    expect(m.marginPct).toBe(20);
    expect(m.markupPct).toBe(25);
  });

  it("keeps them apart where they actually differ", () => {
    /*
     * The case that costs money. At a 20% margin the markup is 25%, and an
     * estimator applying 20% markup believing they priced a 20% margin has
     * underpriced by a fifth of their profit.
     */
    // Priced at a 20% MARGIN: bid = cost / (1 - 0.20) = 100,000.
    const marginPriced = bidMath({ cost: 80_000, bid: 100_000 });
    expect(marginPriced.marginPct).toBe(20);
    expect(marginPriced.markupPct).toBe(25);

    // Priced at a 20% MARKUP by mistake: bid = cost * 1.20 = 96,000.
    // The same intent, 4,000 less profit.
    const markupPriced = bidMath({ cost: 80_000, bid: 80_000 * 1.2 });
    expect(markupPriced.markupPct).toBe(20);
    expect(markupPriced.marginPct).toBeCloseTo(16.67, 1);
    expect(marginPriced.grossProfit! - markupPriced.grossProfit!).toBe(4_000);

    // And the sibling module agrees about the conversion.
    expect(markupForTargetMargin(20)).toBe(25);
  });

  it("reports a loss as a loss", () => {
    const m = bidMath({ cost: 100_000, bid: 90_000 });
    expect(m.grossProfit).toBe(-10_000);
    expect(m.belowCost).toBe(true);
    expect(m.marginPct).toBeCloseTo(-11.11, 1);
  });
});

describe("what an unknown must never become", () => {
  it("does not report zero margin on a bid nobody has set", () => {
    /*
     * The whole point. A zero bid is not a zero margin, it is a bid nobody has
     * set, and dividing by it to print 0% is how an unpriced job reads as a
     * thin one.
     */
    const m = bidMath({ cost: 80_000, bid: 0 });
    expect(m.marginPct).toBeNull();
    expect(m.unknown).toContain("margin, because the bid is zero");
  });

  it("computes nothing downstream of an unknown cost", () => {
    const m = bidMath({ cost: null, bid: 100_000 });
    expect(m.grossProfit).toBeNull();
    expect(m.marginPct).toBeNull();
    expect(m.markupPct).toBeNull();
    expect(m.unknown).toContain("what the work costs");
  });

  it("computes nothing downstream of an unknown bid", () => {
    const m = bidMath({ cost: 80_000, bid: null });
    expect(m.grossProfit).toBeNull();
    expect(m.marginPct).toBeNull();
    expect(unknownSummary(m)).toContain("what the bid asks for");
  });

  it("says nothing is unknown when nothing is", () => {
    expect(unknownSummary(bidMath({ cost: 80_000, bid: 100_000 }))).toBeNull();
  });
});

describe("contingency", () => {
  it("is added to cost before profit is worked out", () => {
    const m = bidMath({ cost: 100_000, bid: 130_000, contingencyPct: 10 });
    expect(m.contingency).toBe(10_000);
    expect(m.loadedCost).toBe(110_000);
    expect(m.grossProfit).toBe(20_000);
    // Markup is over the LOADED cost, because that is what the job is
    // expected to consume.
    expect(m.markupPct).toBeCloseTo(18.18, 1);
  });

  it("is absent rather than zero when the account does not use one", () => {
    const m = bidMath({ cost: 100_000, bid: 130_000 });
    expect(m.contingency).toBeNull();
    expect(m.loadedCost).toBe(100_000);
  });
});

describe("showing the arithmetic", () => {
  it("writes out how each figure was reached", () => {
    // An estimator who cannot see how a number was reached cannot tell a wrong
    // one from a surprising one.
    const lines = explainBidMath(bidMath({ cost: 80_000, bid: 100_000, contingencyPct: 5 }));
    expect(lines.join(" ")).toContain("sum of every trade");
    expect(lines.join(" ")).toContain("Contingency is added to cost");
    expect(lines.join(" ")).toContain("divided by the BID");
    expect(lines.join(" ")).toContain("divided by the COST");
    expect(lines.join(" ")).toContain("neither is the other");
    expect(lines.join(" ")).toContain("rounded to the cent at each step");
  });

  it("stops at the first thing it cannot work out", () => {
    const lines = explainBidMath(bidMath({ cost: null, bid: 100_000 }));
    expect(lines).toEqual(["Cost is unknown, so nothing below it can be worked out."]);
  });

  it("says the bid is unset rather than showing a profit of the whole cost", () => {
    const lines = explainBidMath(bidMath({ cost: 80_000, bid: null }));
    expect(lines.join(" ")).toContain("bid amount has not been set");
    expect(lines.join(" ")).not.toContain("Margin is");
  });
});
