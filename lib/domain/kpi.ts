/**
 * Custom-KPI catalog. A fixed, safe set of metrics an operator can pin to the
 * Analytics dashboard, each computed by a bounded query (never free-form SQL).
 * This module is pure (catalog + validation + formatting) and unit-tested; the
 * data layer maps a metric id to its query.
 */

export type KpiUnit = "count" | "currency" | "percent";

export interface KpiMetricDef {
  id: string;
  label: string; // default label suggestion
  unit: KpiUnit;
  /** Whether a lookback window (days) applies. */
  usesDays: boolean;
  /** Whether a minimum-score filter applies. */
  usesMinScore: boolean;
  /** One-line explanation for the picker. */
  help: string;
}

export const KPI_METRICS: KpiMetricDef[] = [
  {
    id: "open_opportunities",
    label: "Open opportunities",
    unit: "count",
    usesDays: false,
    usesMinScore: true,
    help: "How many opportunities are still in play.",
  },
  {
    id: "pipeline_value",
    label: "Pipeline value",
    unit: "currency",
    usesDays: false,
    usesMinScore: true,
    help: "Total estimated value of everything still in play.",
  },
  {
    id: "opportunities_added",
    label: "New opportunities",
    unit: "count",
    usesDays: true,
    usesMinScore: false,
    help: "Opportunities that entered the pipeline in the window.",
  },
  {
    id: "bids_submitted",
    label: "Bids submitted",
    unit: "count",
    usesDays: true,
    usesMinScore: false,
    help: "Bids you submitted in the window.",
  },
  {
    id: "win_rate",
    label: "Win rate",
    unit: "percent",
    usesDays: true,
    usesMinScore: false,
    help: "Wins divided by decided bids (leave days at 0 for all time).",
  },
  {
    id: "avg_margin",
    label: "Avg margin on wins",
    unit: "percent",
    usesDays: false,
    usesMinScore: false,
    help: "Average profit margin across won bids.",
  },
  {
    id: "active_contracts",
    label: "Active contracts",
    unit: "count",
    usesDays: false,
    usesMinScore: false,
    help: "Contracts currently under performance tracking.",
  },
  {
    id: "active_contract_revenue",
    label: "Active contract revenue",
    unit: "currency",
    usesDays: false,
    usesMinScore: false,
    help: "Total award value of active contracts.",
  },
];

const METRIC_BY_ID = new Map(KPI_METRICS.map((m) => [m.id, m]));

export function getMetric(id: string): KpiMetricDef | undefined {
  return METRIC_BY_ID.get(id);
}

export interface KpiParams {
  days?: number;
  minScore?: number;
}

/** Clamp/normalize raw params to what the chosen metric actually supports. */
export function normalizeKpiParams(metricId: string, raw: unknown): KpiParams {
  const metric = getMetric(metricId);
  if (!metric) return {};
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: KpiParams = {};
  if (metric.usesDays) {
    const d = Math.floor(Number(r.days));
    out.days = Number.isFinite(d) ? Math.min(3650, Math.max(0, d)) : 30;
  }
  if (metric.usesMinScore) {
    const s = Math.floor(Number(r.minScore));
    out.minScore = Number.isFinite(s) ? Math.min(100, Math.max(0, s)) : 0;
  }
  return out;
}

/** Validate a create payload; returns the clean definition or an error. */
export function parseKpiInput(
  body: unknown
): { ok: true; label: string; metric: string; params: KpiParams } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid body." };
  const b = body as Record<string, unknown>;
  const label = typeof b.label === "string" ? b.label.trim() : "";
  const metric = typeof b.metric === "string" ? b.metric : "";
  if (!getMetric(metric)) return { ok: false, error: "Unknown metric." };
  const params = normalizeKpiParams(metric, b.params);
  const finalLabel = label || getMetric(metric)!.label;
  return { ok: true, label: finalLabel, metric, params };
}

/** Format a computed KPI value for display given its unit. */
export function formatKpiValue(value: number | null, unit: KpiUnit): string {
  if (value == null || !Number.isFinite(value)) return "-";
  if (unit === "percent") return `${Math.round(value)}%`;
  if (unit === "currency") {
    return value.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
  }
  return Math.round(value).toLocaleString("en-US");
}

/** A short human description of the params, e.g. "last 30 days · score ≥ 70". */
export function describeKpiParams(metricId: string, params: KpiParams): string {
  const parts: string[] = [];
  const metric = getMetric(metricId);
  if (metric?.usesDays && params.days != null) {
    parts.push(params.days === 0 ? "all time" : `last ${params.days} days`);
  }
  if (metric?.usesMinScore && params.minScore != null && params.minScore > 0) {
    parts.push(`score ≥ ${params.minScore}`);
  }
  return parts.join(" · ");
}
