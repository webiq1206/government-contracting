/** Display compatibility only: retain the stored values, never recompute a KPI. */
type Row = Record<string, unknown>;
const record = (value: unknown): Row | null =>
  value != null && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
const rows = (value: unknown): Row[] => Array.isArray(value)
  ? value.map(record).filter((row): row is Row => row !== null)
  : [];
const owns = (row: Row | null, key: string): boolean =>
  row !== null && Object.prototype.hasOwnProperty.call(row, key);

/**
 * Analytics Engine stores nested fields. Earlier snapshots used flat fields.
 * A present current field wins even when empty or malformed: falling back in
 * that case could revive an older, contradictory number from the same row.
 * Missing current fields may use their legacy counterparts independently.
 */
export function normalizeAnalyticsSnapshot(value: unknown) {
  const snapshot = record(value);
  const rates = record(snapshot?.win_rate);
  const breakdown = (key: string) => rows(owns(rates, key) ? rates?.[key] : snapshot?.[key]);

  let cashFlow = record(snapshot?.cash_flow);
  if (owns(snapshot, "cash_flow_projection")) {
    const projection = record(snapshot?.cash_flow_projection);
    cashFlow = Array.isArray(projection?.buckets)
      ? Object.fromEntries(rows(projection.buckets)
          .filter(bucket => [30, 60, 90].includes(bucket.days as number))
          .map(bucket => [String(bucket.days), bucket.amount ?? null]))
      : null;
  }

  let velocity = record(snapshot?.velocity);
  if (owns(snapshot, "pipeline_velocity")) {
    const pipeline = record(snapshot?.pipeline_velocity);
    velocity = Array.isArray(pipeline?.by_stage)
      ? Object.fromEntries(rows(pipeline.by_stage)
          .filter(row => typeof row.stage === "string" && row.stage.trim() !== "")
          .map(row => [String(row.stage), row.count ?? null]))
      : null;
  }

  return {
    byNaics: breakdown("by_naics"),
    byAgency: breakdown("by_agency"),
    byGeography: breakdown("by_geography"),
    cashFlow,
    velocity,
    subRankings: rows(owns(snapshot, "sub_reliability_rankings")
      ? snapshot?.sub_reliability_rankings : snapshot?.sub_rankings),
  };
}
