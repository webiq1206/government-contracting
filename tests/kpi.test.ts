import { describe, it, expect } from "vitest";
import {
  KPI_METRICS,
  getMetric,
  normalizeKpiParams,
  parseKpiInput,
  formatKpiValue,
  describeKpiParams,
} from "@/lib/domain/kpi";

describe("KPI catalog", () => {
  it("every metric has a unique id and a unit", () => {
    const ids = KPI_METRICS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(KPI_METRICS.every((m) => ["count", "currency", "percent"].includes(m.unit))).toBe(true);
  });
});

describe("normalizeKpiParams", () => {
  it("keeps only params the metric supports", () => {
    // open_opportunities uses minScore, not days
    const p = normalizeKpiParams("open_opportunities", { days: 30, minScore: 70 });
    expect(p).toEqual({ minScore: 70 });
  });
  it("defaults days to 30 and clamps to range", () => {
    expect(normalizeKpiParams("bids_submitted", {}).days).toBe(30);
    expect(normalizeKpiParams("bids_submitted", { days: -5 }).days).toBe(0);
    expect(normalizeKpiParams("bids_submitted", { days: 99999 }).days).toBe(3650);
  });
  it("clamps minScore to 0..100", () => {
    expect(normalizeKpiParams("pipeline_value", { minScore: 150 }).minScore).toBe(100);
    expect(normalizeKpiParams("pipeline_value", { minScore: -10 }).minScore).toBe(0);
  });
  it("returns nothing for an unknown metric", () => {
    expect(normalizeKpiParams("nope", { days: 5 })).toEqual({});
  });
});

describe("parseKpiInput", () => {
  it("rejects an unknown metric", () => {
    expect(parseKpiInput({ metric: "bogus" }).ok).toBe(false);
  });
  it("falls back to the metric's default label", () => {
    const r = parseKpiInput({ metric: "win_rate", label: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.label).toBe("Win rate");
  });
  it("keeps a custom label and normalized params", () => {
    const r = parseKpiInput({ metric: "opportunities_added", label: "New this month", params: { days: 30 } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.label).toBe("New this month");
      expect(r.params).toEqual({ days: 30 });
    }
  });
});

describe("formatKpiValue", () => {
  it("formats each unit", () => {
    expect(formatKpiValue(42, "count")).toBe("42");
    expect(formatKpiValue(1234567, "currency")).toBe("$1,234,567");
    expect(formatKpiValue(63.4, "percent")).toBe("63%");
  });
  it("shows a dash for null / non-finite", () => {
    expect(formatKpiValue(null, "count")).toBe("-");
    expect(formatKpiValue(NaN, "currency")).toBe("-");
  });
});

describe("describeKpiParams", () => {
  it("describes window and score", () => {
    expect(describeKpiParams("bids_submitted", { days: 30 })).toBe("last 30 days");
    expect(describeKpiParams("win_rate", { days: 0 })).toBe("all time");
    expect(describeKpiParams("pipeline_value", { minScore: 70 })).toBe("score ≥ 70");
  });
  it("omits score when zero", () => {
    expect(describeKpiParams("pipeline_value", { minScore: 0 })).toBe("");
  });
});
