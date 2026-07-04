import { describe, it, expect } from "vitest";
import {
  bidFromMarkup,
  marginFromBid,
  markupForTargetMargin,
  bidForTargetMargin,
  marginScenarios,
  cpiAdjust,
  compStats,
  percentile,
  isOutOfRange,
} from "@/lib/domain/pricing";

describe("pricing math", () => {
  it("bidFromMarkup applies markup on cost", () => {
    expect(bidFromMarkup(1000, 25)).toBe(1250);
  });

  it("marginFromBid computes profit as a share of bid", () => {
    // bid 1250, cost 1000 -> profit 250 -> margin 20%
    expect(marginFromBid(1000, 1250)).toBe(20);
  });

  it("markupForTargetMargin inverts margin correctly", () => {
    // 20% margin => 25% markup
    expect(markupForTargetMargin(20)).toBe(25);
    // 50% margin => 100% markup
    expect(markupForTargetMargin(50)).toBe(100);
  });

  it("bidForTargetMargin hits the target margin exactly", () => {
    const bid = bidForTargetMargin(1000, 30);
    expect(marginFromBid(1000, bid)).toBeCloseTo(30, 1);
  });

  it("marginScenarios models each scenario", () => {
    const s = marginScenarios(1000, [25, 35, 50]);
    expect(s).toHaveLength(3);
    expect(s[0].margin_pct).toBe(25);
    expect(marginFromBid(1000, s[2].bid_amount)).toBeCloseTo(50, 1);
    expect(s[0].profit).toBeGreaterThan(0);
  });

  it("cpiAdjust scales by index ratio", () => {
    const cpi = { 2020: 100, 2024: 120 };
    expect(cpiAdjust(1000, 2020, 2024, cpi)).toBe(1200);
  });

  it("cpiAdjust returns original when a year is missing", () => {
    expect(cpiAdjust(1000, 2019, 2024, { 2024: 120 })).toBe(1000);
  });

  it("compStats computes count/avg/median/percentiles", () => {
    const s = compStats([100, 200, 300, 400]);
    expect(s.count).toBe(4);
    expect(s.average).toBe(250);
    expect(s.median).toBe(250);
    expect(s.p25).toBeLessThan(s.median);
    expect(s.p75).toBeGreaterThan(s.median);
  });

  it("compStats ignores zero/negative/NaN", () => {
    const s = compStats([0, -5, NaN, 100, 200]);
    expect(s.count).toBe(2);
    expect(s.average).toBe(150);
  });

  it("percentile interpolates", () => {
    expect(percentile([10, 20, 30, 40], 50)).toBe(25);
  });

  it("isOutOfRange flags beyond tolerance", () => {
    expect(isOutOfRange(130, 100, 20).outOfRange).toBe(true);
    expect(isOutOfRange(115, 100, 20).outOfRange).toBe(false);
    expect(isOutOfRange(80, 100, 20).outOfRange).toBe(false);
    expect(isOutOfRange(70, 100, 20).outOfRange).toBe(true);
  });
});
