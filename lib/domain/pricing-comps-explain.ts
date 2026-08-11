/**
 * Plain-English helpers for explaining historical pricing comps and where a
 * candidate price sits relative to the CPI-adjusted award band.
 */

export interface CompBand {
  count: number;
  median: number;
  average: number;
  p25: number;
  p75: number;
}

export type CompPositionTone =
  | "below_band"
  | "low"
  | "typical"
  | "high"
  | "above_band"
  | "unknown";

export interface CompPosition {
  tone: CompPositionTone;
  /** Short badge label, e.g. "Below typical range". */
  label: string;
  /** One-sentence explanation for a tooltip or supporting line. */
  explanation: string;
  /**
   * 0–100 placement on a visual scale spanning p25→p75 with a little padding
   * outside the band so outliers remain visible.
   */
  markerPct: number | null;
  /** Signed % vs median (positive = above median). */
  vsMedianPct: number | null;
}

function num(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

/** Pull CompBand from pricing_summary.comp_stats (or a flat fallback shape). */
export function readCompBand(pricing: Record<string, unknown> | null | undefined): CompBand | null {
  if (!pricing) return null;
  const stats =
    (pricing.comp_stats as Record<string, unknown> | undefined) ?? pricing;
  const band: CompBand = {
    count: num(stats.count ?? pricing.comp_count),
    median: num(stats.median),
    average: num(stats.average),
    p25: num(stats.p25),
    p75: num(stats.p75),
  };
  if (band.count <= 0 || band.median <= 0) return null;
  return band;
}

/**
 * Where `amount` sits vs the middle 50% of historical awards (p25–p75) and the
 * median. Used for quote/bid/est-value callouts on the comps card.
 */
export function positionInCompBand(
  amount: number | null | undefined,
  band: CompBand | null | undefined
): CompPosition {
  if (amount == null || !Number.isFinite(amount) || amount <= 0 || !band) {
    return {
      tone: "unknown",
      label: "No price to compare",
      explanation: "Enter a quote or build a bid to see how it compares to historical awards.",
      markerPct: null,
      vsMedianPct: null,
    };
  }

  const { p25, median, p75 } = band;
  const vsMedianPct =
    median > 0 ? Math.round((((amount - median) / median) * 100) * 10) / 10 : null;

  // Map onto a padded scale: 10% left of p25 → 10% right of p75.
  const span = Math.max(p75 - p25, median * 0.01, 1);
  const left = p25 - span * 0.15;
  const right = p75 + span * 0.15;
  const raw = ((amount - left) / Math.max(right - left, 1)) * 100;
  const markerPct = Math.min(100, Math.max(0, Math.round(raw * 10) / 10));

  if (amount < p25) {
    const below = amount < p25 - span * 0.05;
    return {
      tone: below ? "below_band" : "low",
      label: below ? "Below typical range" : "Low end of range",
      explanation:
        vsMedianPct != null
          ? `About ${Math.abs(vsMedianPct)}% below the historical median. Low can win on price, or it can signal missing scope.`
          : "This price sits below the middle 50% of recent comparable awards.",
      markerPct,
      vsMedianPct,
    };
  }
  if (amount > p75) {
    const above = amount > p75 + span * 0.05;
    return {
      tone: above ? "above_band" : "high",
      label: above ? "Above typical range" : "High end of range",
      explanation:
        vsMedianPct != null
          ? `About ${Math.abs(vsMedianPct)}% above the historical median. High prices need a clear reason (scope, risk, or quality).`
          : "This price sits above the middle 50% of recent comparable awards.",
      markerPct,
      vsMedianPct,
    };
  }
  const nearMedian = Math.abs(amount - median) <= span * 0.1;
  return {
    tone: nearMedian ? "typical" : amount < median ? "low" : "high",
    label: nearMedian ? "Near historical median" : amount < median ? "Below median" : "Above median",
    explanation:
      vsMedianPct != null
        ? `Within the middle 50% of comps, ${Math.abs(vsMedianPct)}% ${
            (vsMedianPct ?? 0) >= 0 ? "above" : "below"
          } the median. A common competitive zone.`
        : "Within the middle 50% of recent comparable awards.",
    markerPct,
    vsMedianPct,
  };
}

export const COMP_METRIC_TIPS: Record<keyof CompBand, string> = {
  count:
    "How many past federal awards Brost Co found for this NAICS (and state when available) over about the last 36 months. More comps = a more reliable picture.",
  median:
    "The middle award amount after inflation adjustment. Half of comps were lower, half higher. This is the best single benchmark for a typical job of this type.",
  average:
    "The arithmetic mean of adjusted award amounts. A few very large awards can pull this above the median, so treat it as secondary to the median.",
  p25:
    "25th percentile: 25% of comparable awards were at or below this amount. The low end of the typical competitive band.",
  p75:
    "75th percentile: 75% of comparable awards were at or below this amount. The high end of the typical competitive band.",
};

export function cpiTip(year: number | null | undefined, seriesId: string | null | undefined): string {
  const y = year != null && year > 0 ? String(year) : "today's";
  const series = seriesId ? ` (BLS series ${seriesId})` : "";
  return `Older awards are scaled to ${y} dollars using the Consumer Price Index${series}, so a 2022 award is compared fairly to today's prices. Without this, older wins would look artificially cheap.`;
}
