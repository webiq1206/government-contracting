import type { ScoreBreakdown } from "../types";

/** Summarize recorded scoring evidence, never infer a match from field presence. */
export function buildMatchBadges({ breakdown, value, riskCount }: {
  breakdown: ScoreBreakdown | null; value: number | null; riskCount: number;
}): { label: string; tone: "neutral" | "risk" }[] {
  const dimensions = breakdown?.dimensions ?? [];
  const categories = [
    { label: "NAICS", keys: ["naics", "naics_active", "naics_match", "trade_match"] },
    { label: "Service area", keys: ["geography", "geographic_fit", "geo_fit", "location", "location_fit", "service_area", "service_area_fit"] },
    { label: "Size fit", keys: ["value", "value_in_band", "contract_value", "contract_size", "size_band"] },
  ];
  const badges: { label: string; tone: "neutral" | "risk" }[] = categories.map(({ label, keys }) => {
    if (label === "Size fit" && (value == null || !Number.isFinite(value) || value <= 0)) {
      return { label: "Size fit: value unknown", tone: "neutral" };
    }
    const dimension = dimensions.find(d => keys.includes(d.key.toLowerCase()));
    if (!dimension || !Number.isFinite(dimension.points) || !Number.isFinite(dimension.max_points) || dimension.max_points <= 0) {
      return { label: `${label}: no recorded score`, tone: "neutral" };
    }
    return { label: `${label} score: ${dimension.points}/${dimension.max_points}`, tone: dimension.points <= 0 ? "risk" : "neutral" };
  });
  const exclusions = breakdown?.hard_exclusions_triggered?.length ?? 0;
  if (exclusions) badges.push({ label: `${exclusions} exclusion${exclusions === 1 ? "" : "s"} recorded`, tone: "risk" });
  if (riskCount) badges.push({ label: `${riskCount} risk${riskCount === 1 ? "" : "s"} to review`, tone: "risk" });
  return badges;
}
