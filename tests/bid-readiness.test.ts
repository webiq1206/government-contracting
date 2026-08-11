import { describe, it, expect } from "vitest";
import { computeBidReadiness } from "@/lib/domain/bid-readiness";

describe("computeBidReadiness", () => {
  it("surfaces uncovered trades and out-of-range quotes", () => {
    const result = computeBidReadiness({
      stage: "quote_entry",
      status: "open",
      deadline: "2026-09-01",
      riskFlags: [],
      requiredTrades: ["Electrical", "Plumbing"],
      quotes: [{ trade: "Electrical", quote_amount: 5000, is_out_of_range: true }],
      tradeCoverageUncovered: 1,
      subsFound: 3,
      hasBid: false,
    });
    expect(result.attention.some((a) => a.key === "uncovered")).toBe(true);
    expect(result.attention.some((a) => a.key === "oor")).toBe(true);
    expect(result.summary).toContain("Quotes on 1/2 trades");
  });

  it("flags missing subs during sourcing stages", () => {
    const result = computeBidReadiness({
      stage: "sub_research",
      status: "open",
      deadline: null,
      riskFlags: [],
      requiredTrades: ["HVAC"],
      quotes: [],
      tradeCoverageUncovered: 1,
      subsFound: 0,
      hasBid: false,
    });
    expect(result.attention.some((a) => a.key === "no-subs")).toBe(true);
  });
});
