import { describe, it, expect } from "vitest";
import { selectQuotesForBid, type QuoteForSelection } from "@/lib/domain/pricing";

/**
 * A bid is priced from one quote per trade.
 *
 * The outreach workflow exists to collect competing quotes for the same scope,
 * so an opportunity normally holds several per trade. Summing them all priced
 * the job as though every bidder were hired at once, and the generated
 * document listed each competitor as its own line item for the agency to read.
 */
const q = (
  id: string,
  sub: string | null,
  trade: string | null,
  amount: number
): QuoteForSelection => ({ id, subcontractor_id: sub, trade, quote_amount: amount });

const total = (qs: QuoteForSelection[]) => qs.reduce((a, x) => a + x.quote_amount, 0);

describe("choosing which quotes a bid is built from", () => {
  it("takes one quote per trade, not the sum of all of them", () => {
    const sel = selectQuotesForBid([
      q("1", "a", "Electrical", 50_000),
      q("2", "b", "Electrical", 55_000),
      q("3", "c", "Electrical", 60_000),
      q("4", "a", "Plumbing", 30_000),
      q("5", "b", "Plumbing", 35_000),
    ]);
    // Summing all five gives $230,000 for a job that costs $80,000.
    expect(total(sel.selected)).toBe(80_000);
    expect(sel.selected).toHaveLength(2);
  });

  it("takes the lowest, which can never overstate the cost", () => {
    const sel = selectQuotesForBid([
      q("1", "a", "Roofing", 90_000),
      q("2", "b", "Roofing", 70_000),
    ]);
    expect(sel.selected[0].quote_amount).toBe(70_000);
    expect(sel.alternates[0].quote_amount).toBe(90_000);
  });

  it("keeps the quotes it did not use rather than discarding the comparison", () => {
    const sel = selectQuotesForBid([
      q("1", "a", "HVAC", 40_000),
      q("2", "b", "HVAC", 45_000),
      q("3", "c", "HVAC", 42_000),
    ]);
    expect(sel.selected).toHaveLength(1);
    expect(sel.alternates.map((a) => a.id).sort()).toEqual(["2", "3"]);
  });

  it("names every trade where a choice was made", () => {
    const sel = selectQuotesForBid([
      q("1", "a", "Electrical", 50_000),
      q("2", "b", "Electrical", 55_000),
      q("3", "a", "Plumbing", 30_000),
    ]);
    // Plumbing had one quote, so nothing was decided about it.
    expect(sel.contestedTrades).toEqual(["Electrical"]);
  });

  it("treats trade names case and whitespace insensitively", () => {
    // " electrical " and "Electrical" are one trade, not two, or the bid pays
    // for the same scope twice on a data-entry difference.
    const sel = selectQuotesForBid([
      q("1", "a", "Electrical", 50_000),
      q("2", "b", " electrical ", 45_000),
    ]);
    expect(sel.selected).toHaveLength(1);
    expect(total(sel.selected)).toBe(45_000);
  });

  it("groups untraded quotes and reports that it guessed", () => {
    const sel = selectQuotesForBid([q("1", "a", null, 20_000), q("2", "b", "", 25_000)]);
    expect(sel.selected).toHaveLength(1);
    expect(sel.contestedTrades).toEqual(["(no trade given)"]);
  });

  it("is stable on an exact tie", () => {
    // Identical amounts must not reorder the bid between runs on the same data.
    const input = [q("first", "a", "Paint", 10_000), q("second", "b", "Paint", 10_000)];
    expect(selectQuotesForBid(input).selected[0].id).toBe("first");
    expect(selectQuotesForBid(input).selected[0].id).toBe("first");
  });

  it("passes a single quote per trade through untouched", () => {
    const sel = selectQuotesForBid([
      q("1", "a", "Electrical", 50_000),
      q("2", "b", "Plumbing", 30_000),
    ]);
    expect(total(sel.selected)).toBe(80_000);
    expect(sel.alternates).toHaveLength(0);
    expect(sel.contestedTrades).toHaveLength(0);
  });

  it("handles an empty set", () => {
    const sel = selectQuotesForBid([]);
    expect(sel.selected).toHaveLength(0);
    expect(sel.contestedTrades).toHaveLength(0);
  });
});
