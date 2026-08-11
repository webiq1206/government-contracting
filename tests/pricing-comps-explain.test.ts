import { describe, it, expect } from "vitest";
import {
  cpiTip,
  positionInCompBand,
  readCompBand,
} from "../lib/domain/pricing-comps-explain";

const band = {
  count: 100,
  median: 2_737_470,
  average: 4_048_593,
  p25: 1_894_747,
  p75: 4_487_469,
};

describe("readCompBand", () => {
  it("reads nested comp_stats", () => {
    const bandOut = readCompBand({
      naics: "562910",
      comp_stats: band,
    });
    expect(bandOut?.median).toBe(band.median);
    expect(bandOut?.count).toBe(100);
  });

  it("returns null when there are no real comps", () => {
    expect(readCompBand({ comp_stats: { count: 0, median: 0 } })).toBeNull();
  });
});

describe("positionInCompBand", () => {
  it("flags a price near the median as typical", () => {
    const pos = positionInCompBand(2_800_000, band);
    expect(pos.tone).toBe("typical");
    expect(pos.markerPct).not.toBeNull();
    expect(pos.vsMedianPct).not.toBeNull();
  });

  it("flags a price below p25", () => {
    const pos = positionInCompBand(500_000, band);
    expect(["below_band", "low"]).toContain(pos.tone);
    expect(pos.label.toLowerCase()).toMatch(/below|low/);
  });

  it("flags a price above p75", () => {
    const pos = positionInCompBand(9_000_000, band);
    expect(["above_band", "high"]).toContain(pos.tone);
  });
});

describe("cpiTip", () => {
  it("mentions inflation adjustment and year", () => {
    const tip = cpiTip(2026, "CUUR0000SA0");
    expect(tip).toMatch(/Consumer Price Index/i);
    expect(tip).toContain("2026");
    expect(tip).toContain("CUUR0000SA0");
  });
});
