import { describe, expect, it } from "vitest";
import { normalizeAnalyticsSnapshot } from "@/lib/domain/analytics-snapshot";

const producer = {
  win_rate: { by_naics: [{ key: "561210", won: 2, lost: 2, win_rate: 50 }], by_agency: [{ key: "Synthetic agency", won: 1, lost: 0, win_rate: 100 }], by_geography: [{ key: "ID", won: 0, lost: 1, win_rate: 0 }] },
  cash_flow_projection: { window_days: [30, 60, 90], buckets: [{ days: 30, amount: 0 }, { days: 60, amount: 1200 }, { days: 90, amount: 3000 }], basis: "milestones" },
  pipeline_velocity: { note: "counts per stage (not durations)", by_stage: [{ stage: "scoring", count: 2 }, { stage: "submitted", count: 0 }] },
  sub_reliability_rankings: [{ company_name: "Synthetic sub", reliability_score: 95 }],
};
describe("stored Reports snapshot compatibility", () => {
  it("reads the analytics engine's actual nested output without recalculating it", () => {
    const actual = normalizeAnalyticsSnapshot(producer);
    expect(actual.byNaics).toEqual(producer.win_rate.by_naics);
    expect(actual.byAgency).toEqual(producer.win_rate.by_agency);
    expect(actual.byGeography).toEqual(producer.win_rate.by_geography);
    expect(actual.cashFlow).toEqual({ "30": 0, "60": 1200, "90": 3000 });
    expect(actual.velocity).toEqual({ scoring: 2, submitted: 0 });
    expect(actual.subRankings).toEqual(producer.sub_reliability_rankings);
  });
  it("retains supported legacy snapshot values", () => {
    const legacy = {by_naics: [{naics: "561210", wins: 2, losses: 2, win_rate: 50}], cash_flow: {day_30: 0, d90: 3000}, velocity: {scoring: 2}, sub_rankings: [{name: "Synthetic sub", score: 95}]};
    const actual = normalizeAnalyticsSnapshot(legacy);
    expect(actual.byNaics).toEqual(legacy.by_naics);
    expect(actual.cashFlow).toEqual(legacy.cash_flow);
    expect(actual.velocity).toEqual(legacy.velocity);
    expect(actual.subRankings).toEqual(legacy.sub_rankings);
  });
  it("prefers a present current field even when empty, rather than reviving stale legacy data", () => {
    const actual = normalizeAnalyticsSnapshot({...producer, win_rate: {by_naics: []}, by_naics: [{wins: 99}], cash_flow: {"30": 999}, velocity: {obsolete: 99}, sub_rankings: [{name: "Old"}]});
    expect(actual.byNaics).toEqual([]);
    expect(actual.cashFlow?.["30"]).toBe(0);
    expect(actual.velocity).toEqual({scoring: 2, submitted: 0});
    expect(actual.subRankings).toEqual(producer.sub_reliability_rankings);
  });
  it("falls back per field when that current field is absent", () => {
    const actual = normalizeAnalyticsSnapshot({win_rate: {overall: 50}, by_naics: [{key: "legacy"}], cash_flow: {"60": 0}});
    expect(actual.byNaics).toEqual([{key: "legacy"}]);
    expect(actual.cashFlow).toEqual({"60": 0});
  });
  it("never substitutes zero for unknown or missing projection amounts", () => {
    const actual = normalizeAnalyticsSnapshot({cash_flow_projection: {buckets: [{days: 30, amount: null}, {days: 90, amount: 0}, {days: 120, amount: 999}]}});
    expect(actual.cashFlow).toEqual({"30": null, "90": 0});
    expect(actual.cashFlow?.["60"]).toBeUndefined();
  });
  it("rejects malformed current containers instead of showing contradictory legacy data", () => {
    const actual = normalizeAnalyticsSnapshot({win_rate: {by_naics: "broken"}, by_naics: [{key: "old"}], cash_flow_projection: null, cash_flow: {"30": 10}, pipeline_velocity: {by_stage: "broken"}, velocity: {scoring: 10}, sub_reliability_rankings: null, sub_rankings: [{name: "old"}]});
    expect(actual).toEqual({byNaics: [], byAgency: [], byGeography: [], cashFlow: null, velocity: null, subRankings: []});
  });
  it.each([null, undefined, [], "invalid"])('keeps absent/invalid snapshot %s absent', value => {
    expect(normalizeAnalyticsSnapshot(value)).toEqual({byNaics: [], byAgency: [], byGeography: [], cashFlow: null, velocity: null, subRankings: []});
  });
  it("does not mutate stored data", () => {
    const before = JSON.stringify(producer);
    normalizeAnalyticsSnapshot(producer);
    expect(JSON.stringify(producer)).toBe(before);
  });
});
