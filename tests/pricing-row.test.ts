import { describe, expect, it } from "vitest";
import {
  compareScenarios,
  emptyRow,
  parseConfidence,
  parseCoveredBy,
  priceRow,
  pricingSheet,
  sheetSummary,
  tradeScopeKey,
  type PricingRow,
} from "../lib/domain/pricing-row";

/**
 * What a pricing row has to refuse to say.
 *
 * The old model was an amount and a payment-terms string, and the failure it
 * produced was not a wrong number. It was a bid assembled out of half-answers
 * that rendered exactly like a bid assembled out of signed quotes: the same
 * confident total, the same green tick, nothing on screen distinguishing a
 * trade with a firm quote in hand from a trade where somebody remembered a
 * figure off a phone call and never asked whether it included the tax.
 *
 * So most of what is asserted below is a refusal.
 */

const NOW = new Date("2026-03-01T12:00:00Z");

function row(patch: Partial<PricingRow> = {}): PricingRow {
  return { ...emptyRow("Electrical"), ...patch };
}

describe("the identity of a trade scope", () => {
  it("is stable across the ways people write the same trade", () => {
    const forms = ["HVAC", "hvac", " HVAC ", "H.V.A.C.", "H V A C"];
    const keys = new Set(forms.map(tradeScopeKey));
    // The first four normalise together; the point is that case, padding and
    // separator punctuation never produce two rows pricing the same work.
    expect(tradeScopeKey("HVAC")).toBe(tradeScopeKey("hvac"));
    expect(tradeScopeKey("HVAC")).toBe(tradeScopeKey("  HVAC  "));
    expect(tradeScopeKey("H.V.A.C.")).toBe(tradeScopeKey("HVAC"));
    expect(keys.size).toBeLessThan(forms.length);
  });

  it("keeps genuinely different trades apart", () => {
    expect(tradeScopeKey("Electrical")).not.toBe(tradeScopeKey("Electrical - low voltage"));
    expect(tradeScopeKey("Plumbing")).not.toBe(tradeScopeKey("Mechanical"));
  });

  it("treats a hyphen and a slash as the same separator", () => {
    expect(tradeScopeKey("Heating/Cooling")).toBe(tradeScopeKey("Heating - Cooling"));
  });
});

describe("what fails closed", () => {
  it("reads an unrecognised confidence as unknown, never as firm", () => {
    expect(parseConfidence("firm")).toBe("firm");
    expect(parseConfidence("FIRM")).toBe("firm");
    expect(parseConfidence("definitely")).toBe("unknown");
    expect(parseConfidence(null)).toBe("unknown");
    expect(parseConfidence(undefined)).toBe("unknown");
    expect(parseConfidence(true)).toBe("unknown");
  });

  it("reads unrecorded coverage of an exclusion as nobody assigned", () => {
    expect(parseCoveredBy("self_perform")).toBe("self_perform");
    expect(parseCoveredBy("somebody")).toBe("unassigned");
    expect(parseCoveredBy(undefined)).toBe("unassigned");
  });
});

describe("one trade's total", () => {
  it("adds up when every component is established", () => {
    const p = priceRow(
      row({ baseQuote: 100_000, taxes: 8_000, freight: 1_500, selectedSubId: "s1", confidence: "firm", quoteExpiresOn: "2026-06-01" }),
      { now: NOW }
    );
    expect(p.total).toBe(109_500);
    expect(p.problems.filter((x) => x.severity === "blocker")).toEqual([]);
  });

  it("has no total when the base quote is unknown", () => {
    const p = priceRow(row({ baseQuote: null }), { now: NOW });
    expect(p.total).toBeNull();
    expect(p.problems.some((x) => x.code === "unknown:baseQuote" && x.severity === "blocker")).toBe(
      true
    );
  });

  it("distinguishes a trade with no freight from a trade whose freight nobody asked about", () => {
    const noFreight = priceRow(row({ baseQuote: 100_000, selectedSubId: "s1" }), { now: NOW });
    const freightPending = priceRow(
      row({ baseQuote: 100_000, selectedSubId: "s1", pendingComponents: ["freight"] }),
      { now: NOW }
    );
    expect(noFreight.total).toBe(100_000);
    // The whole point: the second is not 100,000, it is not yet known.
    expect(freightPending.total).toBeNull();
    expect(freightPending.problems.some((p) => p.code === "unknown:freight")).toBe(true);
  });

  it("does not treat a stale figure as current once the component is flagged pending", () => {
    // A number left in the box from last week is not the newer fact.
    const p = priceRow(
      row({ baseQuote: 100_000, taxes: 8_000, pendingComponents: ["taxes"], selectedSubId: "s1" }),
      { now: NOW }
    );
    expect(p.total).toBeNull();
  });

  it("refuses to total an included alternate that has no price", () => {
    const p = priceRow(
      row({
        baseQuote: 100_000,
        selectedSubId: "s1",
        alternates: [{ label: "Add generator", amount: null, included: true }],
      }),
      { now: NOW }
    );
    expect(p.total).toBeNull();
    expect(p.problems.some((x) => x.code === "alternate_unpriced")).toBe(true);
  });

  it("ignores an alternate that is not in the bid", () => {
    const p = priceRow(
      row({
        baseQuote: 100_000,
        selectedSubId: "s1",
        alternates: [
          { label: "Add generator", amount: null, included: false },
          { label: "Upgrade panel", amount: 4_000, included: true },
        ],
      }),
      { now: NOW }
    );
    expect(p.total).toBe(104_000);
  });
});

describe("an exclusion is a hole, not a discount", () => {
  it("blocks when excluded work has nobody carrying it", () => {
    const p = priceRow(
      row({
        baseQuote: 90_000,
        selectedSubId: "s1",
        exclusions: [{ text: "Crane and rigging", coveredBy: "unassigned" }],
      }),
      { now: NOW }
    );
    // The arithmetic still works. The bid does not.
    expect(p.total).toBe(90_000);
    expect(p.clear).toBe(false);
    expect(p.problems.some((x) => x.code === "exclusion_unassigned" && x.severity === "blocker")).toBe(
      true
    );
  });

  it("clears once the work is assigned somewhere", () => {
    const p = priceRow(
      row({
        baseQuote: 90_000,
        selectedSubId: "s1",
        confidence: "firm",
        quoteExpiresOn: "2026-06-01",
        exclusions: [{ text: "Crane and rigging", coveredBy: "self_perform" }],
      }),
      { now: NOW }
    );
    expect(p.problems.some((x) => x.code === "exclusion_unassigned")).toBe(false);
  });
});

describe("a number nobody can account for", () => {
  it("blocks a manual adjustment with no reason", () => {
    const p = priceRow(
      row({ baseQuote: 100_000, manualAdjustment: 11_000, selectedSubId: "s1" }),
      { now: NOW }
    );
    expect(p.problems.some((x) => x.code === "adjustment_unexplained" && x.severity === "blocker")).toBe(
      true
    );
  });

  it("accepts one that carries its reason", () => {
    const p = priceRow(
      row({
        baseQuote: 100_000,
        manualAdjustment: 11_000,
        manualAdjustmentReason: "Quote excluded the temporary power drop, priced from the 2025 job.",
        selectedSubId: "s1",
      }),
      { now: NOW }
    );
    expect(p.total).toBe(111_000);
    expect(p.problems.some((x) => x.code === "adjustment_unexplained")).toBe(false);
  });
});

describe("quote validity", () => {
  it("hard-blocks an expired quote where the solicitation requires validity", () => {
    const p = priceRow(
      row({ baseQuote: 100_000, selectedSubId: "s1", quoteExpiresOn: "2026-02-01" }),
      { now: NOW, quoteValidityRequired: true }
    );
    const problem = p.problems.find((x) => x.code === "quote_expired");
    expect(problem?.severity).toBe("blocker");
  });

  it("warns rather than blocks where it does not", () => {
    const p = priceRow(
      row({ baseQuote: 100_000, selectedSubId: "s1", quoteExpiresOn: "2026-02-01" }),
      { now: NOW, quoteValidityRequired: false }
    );
    expect(p.problems.find((x) => x.code === "quote_expired")?.severity).toBe("warning");
  });

  it("warns when the quote dies before the bid is even due", () => {
    const p = priceRow(
      row({ baseQuote: 100_000, selectedSubId: "s1", quoteExpiresOn: "2026-03-15" }),
      { now: NOW, bidDueAt: new Date("2026-04-01T00:00:00Z") }
    );
    expect(p.problems.some((x) => x.code === "quote_expires_before_due")).toBe(true);
  });

  it("says nobody recorded an expiry rather than assuming the price holds forever", () => {
    const p = priceRow(row({ baseQuote: 100_000, selectedSubId: "s1" }), { now: NOW });
    expect(p.problems.some((x) => x.code === "no_expiry")).toBe(true);
  });
});

describe("competing quotes", () => {
  it("does not pick the cheapest on the operator's behalf", () => {
    const p = priceRow(
      row({
        baseQuote: null,
        candidates: [
          { quoteId: "q1", subId: "a", subName: "A", amount: 88_000, paymentTerms: null, outOfRange: false },
          { quoteId: "q2", subId: "b", subName: "B", amount: 94_000, paymentTerms: null, outOfRange: false },
        ],
      }),
      { now: NOW }
    );
    expect(p.total).toBeNull();
    const problem = p.problems.find((x) => x.code === "competing_quotes_unselected");
    expect(problem?.severity).toBe("blocker");
    // Nothing anywhere in the row silently became 88,000.
    expect(p.cost.total).toBeNull();
  });

  it("is satisfied once one is chosen", () => {
    const p = priceRow(
      row({
        baseQuote: 94_000,
        selectedSubId: "b",
        confidence: "firm",
        quoteExpiresOn: "2026-06-01",
        candidates: [
          { quoteId: "q1", subId: "a", subName: "A", amount: 88_000, paymentTerms: null, outOfRange: false },
          { quoteId: "q2", subId: "b", subName: "B", amount: 94_000, paymentTerms: null, outOfRange: false },
        ],
      }),
      { now: NOW }
    );
    expect(p.total).toBe(94_000);
    expect(p.problems.some((x) => x.code === "competing_quotes_unselected")).toBe(false);
  });
});

describe("the sheet against what the solicitation asks for", () => {
  const ctx = { now: NOW };

  it("names a required trade that has no row at all", () => {
    const sheet = pricingSheet(
      ["Electrical", "Plumbing"],
      [row({ baseQuote: 100_000, selectedSubId: "s1" })],
      ctx
    );
    expect(sheet.missingTrades).toEqual(["Plumbing"]);
    expect(sheet.cost).toBeNull();
    expect(sheet.blockers.some((b) => b.code === "trade_unpriced")).toBe(true);
    expect(sheetSummary(sheet)).toContain("Plumbing");
  });

  it("keeps a row whose trade the solicitation no longer lists, and says so", () => {
    const sheet = pricingSheet(
      ["Electrical"],
      [
        row({ baseQuote: 100_000, selectedSubId: "s1", confidence: "firm", quoteExpiresOn: "2026-06-01" }),
        { ...emptyRow("Fire suppression"), baseQuote: 20_000, selectedSubId: "s2" },
      ],
      ctx
    );
    // Not deleted: somebody obtained that price.
    expect(sheet.orphanedRows).toHaveLength(1);
    expect(sheet.orphanedRows[0]?.row.trade).toBe("Fire suppression");
    // And not counted: it is not part of this bid.
    expect(sheet.cost).toBe(100_000);
    expect(sheet.problems.some((p) => p.code === "trade_not_in_scope")).toBe(true);
  });

  it("has no cost at all when one trade of three is unknown", () => {
    const sheet = pricingSheet(
      ["Electrical", "Plumbing", "HVAC"],
      [
        row({ trade: "Electrical", scopeKey: tradeScopeKey("Electrical"), baseQuote: 100_000, selectedSubId: "s1" }),
        { ...emptyRow("Plumbing"), baseQuote: 50_000, selectedSubId: "s2" },
        { ...emptyRow("HVAC"), baseQuote: null },
      ],
      ctx
    );
    expect(sheet.cost).toBeNull();
    expect(sheet.unknownTrades).toEqual(["HVAC"]);
    // Specifically not 150,000, which is what a sum that skips nulls produces.
    expect(sheetSummary(sheet)).toContain("HVAC");
  });

  it("reports the weakest confidence in the sheet, not the average", () => {
    const sheet = pricingSheet(
      ["Electrical", "Plumbing"],
      [
        { ...emptyRow("Electrical"), baseQuote: 100_000, selectedSubId: "s1", confidence: "firm" },
        { ...emptyRow("Plumbing"), baseQuote: 50_000, selectedSubId: "s2", confidence: "rough" },
      ],
      ctx
    );
    expect(sheet.weakestConfidence).toBe("rough");
  });

  it("has no confidence to report when nothing is priced", () => {
    const sheet = pricingSheet(["Electrical"], [emptyRow("Electrical")], ctx);
    expect(sheet.weakestConfidence).toBeNull();
  });

  it("matches rows to required trades however the trade was typed", () => {
    const sheet = pricingSheet(
      ["HVAC"],
      [{ ...emptyRow("hvac"), baseQuote: 40_000, selectedSubId: "s1", confidence: "firm", quoteExpiresOn: "2026-06-01" }],
      ctx
    );
    expect(sheet.missingTrades).toEqual([]);
    expect(sheet.cost).toBe(40_000);
  });
});

describe("scenario comparison", () => {
  it("keeps margin and markup apart", () => {
    // Cost 80,000, bid 100,000. Profit 20,000.
    // Margin is profit over the BID: 20%. Markup is profit over the COST: 25%.
    const [s] = compareScenarios(80_000, [{ label: "As bid", bid: 100_000 }]);
    expect(s.math.grossProfit).toBe(20_000);
    expect(s.math.marginPct).toBe(20);
    expect(s.math.markupPct).toBe(25);
  });

  it("builds a bid from a target margin, and the margin comes back out", () => {
    const [s] = compareScenarios(80_000, [{ label: "At 15%", targetMarginPct: 15 }]);
    expect(s.math.marginPct).toBe(15);
    expect(s.math.bid).toBeGreaterThan(80_000);
  });

  it("applies contingency before the margin, not after", () => {
    const [s] = compareScenarios(100_000, [
      { label: "With 10% contingency", targetMarginPct: 20, contingencyPct: 10 },
    ]);
    expect(s.math.loadedCost).toBe(110_000);
    expect(s.math.marginPct).toBe(20);
    // The bid covers the contingency too, so it is above 110,000/(0.8) of cost.
    expect(s.math.bid).toBe(137_500);
  });

  it("refuses to compare scenarios off an unknown cost", () => {
    const scenarios = compareScenarios(null, [
      { label: "At 10%", targetMarginPct: 10 },
      { label: "At 20%", targetMarginPct: 20 },
    ]);
    for (const s of scenarios) {
      expect(s.math.bid).toBeNull();
      expect(s.math.marginPct).toBeNull();
      // Not a column of zeroes, which is the easiest lie a comparison table
      // can tell.
      expect(s.unknown).toContain("Cost is not known");
    }
  });

  it("has no bid for a margin of 100% or more", () => {
    const [s] = compareScenarios(80_000, [{ label: "Impossible", targetMarginPct: 100 }]);
    expect(s.math.bid).toBeNull();
    expect(s.unknown).toContain("100%");
  });

  it("reports a bid under cost as the loss it is", () => {
    const [s] = compareScenarios(80_000, [{ label: "Lowball", bid: 70_000 }]);
    expect(s.math.grossProfit).toBe(-10_000);
    expect(s.math.belowCost).toBe(true);
  });
});

describe("lead time against the schedule", () => {
  it("flags a sub who cannot start in time", () => {
    const p = priceRow(
      row({ baseQuote: 100_000, selectedSubId: "s1", leadTimeDays: 60 }),
      { now: NOW, daysUntilWorkStarts: 30 }
    );
    expect(p.problems.some((x) => x.code === "lead_time_exceeds_schedule")).toBe(true);
  });

  it("says nothing when the schedule is not known", () => {
    const p = priceRow(
      row({ baseQuote: 100_000, selectedSubId: "s1", leadTimeDays: 60 }),
      { now: NOW }
    );
    // An unknown start date is not a passed check and not a failed one.
    expect(p.problems.some((x) => x.code === "lead_time_exceeds_schedule")).toBe(false);
  });
});
