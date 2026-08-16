import { describe, it, expect } from "vitest";
import { readCompReliability, benchmarkFor } from "@/lib/domain/comp-reliability";
import type { CompStats } from "@/lib/domain/pricing";

const band = (over: Partial<CompStats> = {}): CompStats => ({
  count: 40,
  average: 52_000,
  median: 50_000,
  p25: 40_000,
  p75: 65_000,
  ...over,
});

/** The live Guam opportunity that started this: NAICS 811310, 81 awards. */
const GUAM: CompStats = {
  count: 81,
  average: 256_936,
  median: 39_819,
  p25: 18_455,
  p75: 241_734,
};

describe("comp reliability", () => {
  it("accepts a tight band as a real benchmark", () => {
    const r = readCompReliability(band());
    expect(r.level).toBe("usable");
    expect(r.usableAsBenchmark).toBe(true);
    expect(r.verdict).toMatch(/clustered tightly enough/);
    expect(r.guidance).toMatch(/\$50,000/);
    expect(benchmarkFor(band())).toBe(50_000);
  });

  it("refuses to benchmark the real Guam comp set", () => {
    const r = readCompReliability(GUAM);
    expect(r.level).toBe("unusable");
    expect(r.usableAsBenchmark).toBe(false);
    // 241734 / 18455 = 13.1x, 256936 / 39819 = 6.45x
    expect(r.spreadRatio).toBeCloseTo(13.1, 1);
    expect(r.skewRatio).toBeCloseTo(6.45, 1);
    expect(r.verdict).toMatch(/not comparable to each other/);
    expect(r.verdict).toMatch(/\$18,455 to \$241,734/);
    expect(benchmarkFor(GUAM)).toBeNull();
  });

  it("points at the incumbent's award when the category is noise", () => {
    const r = readCompReliability(GUAM, { incumbentLastAward: 31_961 });
    expect(r.guidance).toMatch(/Do not price off the median/);
    expect(r.guidance).toMatch(/\$31,961/);
    expect(benchmarkFor(GUAM, { incumbentLastAward: 31_961 })).toBe(31_961);
  });

  it("calls a merely spread-out band wide, and still refuses to price off it", () => {
    const r = readCompReliability(band({ p25: 20_000, p75: 80_000, average: 62_000 }));
    expect(r.level).toBe("wide");
    expect(r.usableAsBenchmark).toBe(false);
    expect(r.guidance).toMatch(/sanity check/);
  });

  it("treats a handful of awards as too few to read", () => {
    const r = readCompReliability(band({ count: 3 }));
    expect(r.level).toBe("unusable");
    expect(r.verdict).toMatch(/Only 3 comparable awards/);
  });

  it("says so when there are no comps at all", () => {
    const r = readCompReliability(null);
    expect(r.level).toBe("unusable");
    expect(r.verdict).toMatch(/No comparable awards/);
    expect(benchmarkFor(null)).toBeNull();
    expect(benchmarkFor(null, { incumbentLastAward: 25_000 })).toBe(25_000);
  });

  it("flags heavy skew even when the middle half looks reasonable", () => {
    // p75/p25 = 2.0 (fine), but the mean is 4x the median: outliers dominate.
    const r = readCompReliability(band({ p25: 30_000, p75: 60_000, average: 200_000 }));
    expect(r.level).toBe("unusable");
    expect(r.verdict).toMatch(/average is 4.0x the median/);
  });
});
