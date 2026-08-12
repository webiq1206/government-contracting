import { describe, it, expect } from "vitest";
import { computeBidReadiness } from "@/lib/domain/bid-readiness";

describe("computeBidReadiness", () => {
  it("surfaces per-trade pricing gaps with CTAs", () => {
    const result = computeBidReadiness({
      stage: "quote_entry",
      status: "open",
      deadline: "2026-09-01",
      riskFlags: [],
      requiredTrades: ["Electrical", "Plumbing"],
      quotes: [{ trade: "Electrical", quote_amount: 5000, is_out_of_range: true }],
      tradeCoverageUncovered: 1,
      uncoveredTrades: ["Plumbing"],
      tradeStatuses: [
        { trade: "Electrical", status: "complete", quotes: 1, contacted: 1, found: 1 },
        { trade: "Plumbing", status: "action_required", quotes: 0, contacted: 0, found: 2 },
      ],
      subsFound: 3,
      hasBid: false,
    });
    expect(result.attention.some((a) => a.key === "trade-need-Plumbing")).toBe(true);
    expect(result.attention.some((a) => a.key === "oor")).toBe(true);
    expect(result.percent).toBeGreaterThan(0);
    expect(result.summary).toContain("Quotes on 1/2 trades");
    const plumbing = result.actionRequired.find((a) => a.key === "trade-need-Plumbing");
    expect(plumbing?.action?.label).toMatch(/Plumbing/i);
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
      uncoveredTrades: ["HVAC"],
      subsFound: 0,
      hasBid: false,
    });
    expect(result.attention.some((a) => a.key === "no-subs")).toBe(true);
  });

  it("blocks submission readiness when bid exists with uncovered trades", () => {
    const result = computeBidReadiness({
      stage: "bid_building",
      status: "open",
      deadline: "2026-09-01",
      riskFlags: [],
      requiredTrades: ["HVAC", "Electrical"],
      quotes: [{ trade: "HVAC", quote_amount: 9000 }],
      tradeCoverageUncovered: 1,
      uncoveredTrades: ["Electrical"],
      tradeStatuses: [
        { trade: "HVAC", status: "complete", quotes: 1, contacted: 1, found: 1 },
        { trade: "Electrical", status: "in_progress", quotes: 0, contacted: 2, found: 2 },
      ],
      subsFound: 4,
      hasBid: true,
      packageReady: false,
      packageBlockers: ["Electrical pricing has not been received"],
    });
    expect(result.blocked.length).toBeGreaterThan(0);
    expect(result.packageReady).toBe(false);
  });

  it("uses plain-English flag labels and triage-specific human items", () => {
    const result = computeBidReadiness({
      stage: "scoring",
      status: "open",
      deadline: null,
      riskFlags: ["incomplete_scoring", "stalled_scoring"],
      requiredTrades: [],
      quotes: [],
      tradeCoverageUncovered: 0,
      subsFound: 0,
      hasBid: false,
      humanActionRequired: true,
      tier: "review",
    });
    const flag = result.actionRequired.find((a) => a.key === "flag-incomplete_scoring");
    expect(flag?.label).toBe("Needs a human to finish scoring");
    expect(result.actionRequired.some((a) => a.key === "flag-stalled_scoring")).toBe(
      false
    );
    expect(result.actionRequired.some((a) => a.key === "human-triage")).toBe(true);
  });
});
