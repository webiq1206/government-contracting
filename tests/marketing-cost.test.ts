import { describe, expect, it } from "vitest";
import { estimateMonthlyValue } from "@/lib/domain/marketing-cost";
import { planPrice } from "@/lib/billing/catalog";
describe("buyer-entered value estimate", () => {
  it("includes service costs and shows a loss when the time value is lower", () => {
    const result = estimateMonthlyValue({
      bids: 2,
      hours: 4,
      hourlyCost: 100,
      serviceCost: 200,
      subscription: 1000,
    });
    expect(result).toEqual({
      hoursSaved: 8,
      laborValue: 800,
      totalCost: 1200,
      netValue: -400,
      breakEvenHours: 12,
    });
  });
  it("uses the exact annual amount divided by twelve, not a rounded advertised monthly rate", () => {
    const annual = planPrice("standard", "year");
    const result = estimateMonthlyValue({
      bids: 0,
      hours: 0,
      hourlyCost: 0,
      serviceCost: 0,
      subscription: annual.amountUsd / 12,
    });
    expect(result?.netValue).toBe(-annual.amountUsd / 12);
    expect(result?.breakEvenHours).toBeNull();
  });
  it.each([-1, NaN, Infinity])(
    "rejects invalid amounts (%s) instead of showing a misleading estimate",
    (value) => {
      expect(
        estimateMonthlyValue({
          bids: value,
          hours: 2,
          hourlyCost: 100,
          serviceCost: 0,
          subscription: 1000,
        }),
      ).toBeNull();
    },
  );
});
