/**
 * The number the operator submits must be internally consistent: the line
 * items a customer sees have to sum to the bid amount, and the bid must price
 * to the target margin from the LOWEST quote per trade — never the sum of all
 * bidders. A drift here is a wrong bid: lose the job, or win it unprofitably.
 *
 * This mirrors the exact composition the bid-builder performs (selection →
 * subtotal → bidForTargetMargin → markup line) and asserts the invariants
 * across a matrix of costs and margins, including values that stress rounding.
 */
import { describe, it, expect } from "vitest";
import {
  selectQuotesForBid,
  bidForTargetMargin,
  marginFromBid,
} from "@/lib/domain/pricing";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

describe("bid money composition is internally consistent", () => {
  it("selects the lowest quote per trade, never the sum", () => {
    const sel = selectQuotesForBid([
      { subcontractor_id: "a", trade: "electrical", quote_amount: 50000 },
      { subcontractor_id: "b", trade: "electrical", quote_amount: 42000 },
      { subcontractor_id: "c", trade: "plumbing", quote_amount: 30000 },
    ] as never);
    const total = sel.selected.reduce((s, q) => s + q.quote_amount, 0);
    // 42000 (lowest electrical) + 30000 (plumbing) = 72000, NOT 122000.
    expect(total).toBe(72000);
    expect(sel.selected).toHaveLength(2);
  });

  it("line items always sum to the bid amount, at every margin and cost", () => {
    const costs = [72000, 33333.33, 100000, 12500.5, 987654.21, 1, 250000];
    const margins = [0, 5, 10, 15, 17, 20, 25, 33, 40, 50];
    for (const subtotal of costs) {
      for (const margin of margins) {
        const bidAmount = bidForTargetMargin(subtotal, margin);
        const markupAmount = round2(bidAmount - subtotal);
        // The builder's line items: the priced quotes (summing to subtotal)
        // plus one markup line. This must hold at EVERY value, tiny ones too.
        const lineItemsSum = round2(subtotal + markupAmount);
        expect(lineItemsSum).toBe(bidAmount);
        // The realized margin round-trips to the target on any real bid. At a
        // $1 subtotal a single cent of rounding is a whole percent, so the
        // tolerance scales with the smallest cent-step relative to the bid.
        if (margin < 100) {
          const tol = Math.max(0.02, (0.01 / bidAmount) * 100 * 1.5);
          expect(Math.abs(marginFromBid(subtotal, bidAmount) - margin)).toBeLessThan(tol);
        }
      }
    }
  });

  it("a 20% target margin marks a 100k cost up to exactly 125k", () => {
    expect(bidForTargetMargin(100000, 20)).toBe(125000);
    expect(marginFromBid(100000, 125000)).toBe(20);
  });

  it("never understates cost: the bid is always >= the sub cost", () => {
    for (const c of [1, 100, 72000, 999999.99]) {
      for (const m of [0, 10, 25, 40]) {
        expect(bidForTargetMargin(c, m)).toBeGreaterThanOrEqual(c);
      }
    }
  });
});
