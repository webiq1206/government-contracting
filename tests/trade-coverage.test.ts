import { describe, it, expect } from "vitest";
import { summarizeTradeCoverage } from "@/lib/domain/trade-coverage";

describe("summarizeTradeCoverage", () => {
  it("flags empty required trades as action required", () => {
    const result = summarizeTradeCoverage({
      requiredTrades: ["Electrical", "Plumbing"],
      subs: [
        {
          trade: "Electrical",
          outreach_state: "sent",
          emails_sent: 1,
          calls_logged: 0,
        },
      ],
      quotes: [],
    });
    const electrical = result.trades.find((t) => t.trade === "Electrical")!;
    const plumbing = result.trades.find((t) => t.trade === "Plumbing")!;
    // Fresh "sent" is still owned by auto follow-up; human action comes after.
    expect(electrical.status).toBe("in_progress");
    expect(plumbing.status).toBe("empty");
    expect(result.totals.uncovered).toBe(2);
    expect(result.totals.found).toBe(1);
    expect(result.totals.contacted).toBe(1);
  });

  it("marks a trade complete when a quote exists", () => {
    const result = summarizeTradeCoverage({
      requiredTrades: ["HVAC"],
      subs: [{ trade: "HVAC", outreach_state: "responsive", responded_at: "2026-01-01" }],
      quotes: [{ trade: "HVAC", quote_amount: 12000 }],
    });
    expect(result.trades[0].status).toBe("complete");
    expect(result.totals.quotes).toBe(1);
    expect(result.totals.uncovered).toBe(0);
  });

  it("counts human follow-ups due only after auto follow-up (not fresh sent)", () => {
    const result = summarizeTradeCoverage({
      requiredTrades: ["Roofing"],
      subs: [
        { trade: "Roofing", outreach_state: "sent" },
        { trade: "Roofing", outreach_state: "followed_up" },
        { trade: "Roofing", outreach_state: "declined" },
      ],
      quotes: [],
    });
    expect(result.trades[0].followUpDue).toBe(1);
    expect(result.trades[0].declined).toBe(1);
    expect(result.trades[0].contacted).toBe(3);
  });

  it("does not count draft or send_failed as contacted", () => {
    const result = summarizeTradeCoverage({
      requiredTrades: ["Electrical"],
      subs: [
        { trade: "Electrical", outreach_state: "draft" },
        { trade: "Electrical", outreach_state: "send_failed" },
      ],
      quotes: [],
    });
    expect(result.trades[0].contacted).toBe(0);
    expect(result.trades[0].status).toBe("action_required");
  });
});
