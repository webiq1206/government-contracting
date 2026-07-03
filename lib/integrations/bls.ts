/**
 * Bureau of Labor Statistics (BLS) CPI client. Used for cost-escalation
 * modeling on multi-year contracts. Works unauthenticated at low volume;
 * config.bls.apiKey (when present) just raises the rate limit.
 * Never throws — failures return empty maps.
 */
import { config } from "../config";
import { fetchJson, withRetry } from "./http";

const BLS_BASE = "https://api.bls.gov/publicAPI/v2/timeseries/data/";

/** Raw monthly data point from a BLS series. */
interface BlsDataPoint {
  year?: string;
  period?: string; // "M01".."M12", "M13" = annual avg, "Q0x", "S0x"
  value?: string;
}

interface BlsResponse {
  Results?: {
    series?: Array<{ data?: BlsDataPoint[] }>;
  };
}

export const bls = {
  /**
   * Fetch annual-average CPI index values for a series across a year range.
   * Averages the monthly (M01..M12) values for each year. Returns {} on failure.
   */
  async getCpiSeries(
    seriesId: string,
    startYear: number,
    endYear: number
  ): Promise<Record<number, number>> {
    const body = {
      seriesid: [seriesId],
      startyear: String(startYear),
      endyear: String(endYear),
      ...(config.bls.apiKey ? { registrationkey: config.bls.apiKey } : {}),
    };

    try {
      const data = await withRetry(() =>
        fetchJson<BlsResponse>(BLS_BASE, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      );

      const points = data.Results?.series?.[0]?.data ?? [];
      // Accumulate monthly values per year, then average.
      const sums = new Map<number, { total: number; count: number }>();
      for (const p of points) {
        if (!p.period || !/^M(0[1-9]|1[0-2])$/.test(p.period)) continue; // months only
        const year = Number(p.year);
        const value = Number(p.value);
        if (!Number.isFinite(year) || !Number.isFinite(value)) continue;
        const acc = sums.get(year) ?? { total: 0, count: 0 };
        acc.total += value;
        acc.count += 1;
        sums.set(year, acc);
      }

      const out: Record<number, number> = {};
      for (const [year, { total, count }] of sums) {
        if (count > 0) out[year] = total / count;
      }
      return out;
    } catch {
      return {};
    }
  },

  /** Annual-average CPI index for a single year, or null if unavailable. */
  async cpiIndexForYear(seriesId: string, year: number): Promise<number | null> {
    const series = await this.getCpiSeries(seriesId, year, year);
    return series[year] ?? null;
  },
};
