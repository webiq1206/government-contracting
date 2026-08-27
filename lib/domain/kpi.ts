/**
 * Custom-KPI catalog. A fixed, safe set of metrics an operator can pin to the
 * Analytics dashboard, each computed by a bounded query (never free-form SQL).
 * This module is pure (catalog + validation + formatting) and unit-tested; the
 * data layer maps a metric id to its query.
 *
 * One catalog, not two. A pinned metric and a reported one have to mean the
 * same thing: an operator who pins "Win rate" and then reads a different win
 * rate further down the same page has no way to tell which is right, and will
 * reasonably conclude neither is. So every definition here carries the same
 * provenance the reports do, and the reported metrics are pickable from it.
 */

import type { MetricProvenance, MetricUnit } from "./report-metrics";

export type KpiUnit = "count" | "currency" | "percent" | "days";

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
  /**
   * How it is worked out, in the same shape the reports use.
   *
   * Required, so a metric cannot join this catalog without being able to
   * defend itself the moment somebody disagrees with the figure.
   */
  provenance: MetricProvenance;
}

/** KpiUnit and MetricUnit are the same set; this makes that explicit. */
export function asMetricUnit(u: KpiUnit): MetricUnit {
  return u;
}

export const KPI_METRICS: KpiMetricDef[] = [
  {
    id: "open_opportunities",
    label: "Open opportunities",
    unit: "count",
    usesDays: false,
    usesMinScore: true,
    help: "How many opportunities are still in play.",
    provenance: {
      formula: "Opportunities still open and not dismissed or lost.",
      sources: ["Opportunities"],
      inclusion:
        "Counted at this moment rather than over a window. A score floor, where one is set, applies to the count.",
    },
  },
  {
    id: "pipeline_value",
    label: "Pipeline value",
    unit: "currency",
    usesDays: false,
    usesMinScore: true,
    help: "Total estimated value of everything still in play.",
    provenance: {
      formula: "Estimated value of every open opportunity that carries a figure, added up.",
      sources: ["Opportunities"],
      inclusion:
        "Opportunities publishing no figure are not counted as nought, so this is a floor on the pipeline rather than a view of all of it.",
    },
  },
  {
    id: "opportunities_added",
    label: "New opportunities",
    unit: "count",
    usesDays: true,
    usesMinScore: false,
    help: "Opportunities that entered the pipeline in the window.",
    provenance: {
      formula: "Opportunities created inside the chosen window.",
      sources: ["Opportunities"],
      inclusion:
        "By the date the record was created here, which is when it reached this account, not when the agency posted it.",
    },
  },
  {
    id: "bids_submitted",
    label: "Bids submitted",
    unit: "count",
    usesDays: true,
    usesMinScore: false,
    help: "Bids you submitted in the window.",
    provenance: {
      formula: "Bids with a submission date inside the chosen window.",
      sources: ["Bids"],
      inclusion:
        "By submission date. A bid built in the window and submitted after it counts in the later window.",
    },
  },
  {
    id: "win_rate",
    label: "Win rate",
    unit: "percent",
    usesDays: true,
    usesMinScore: false,
    help: "Wins divided by decided bids (leave days at 0 for all time).",
    provenance: {
      formula: "Wins divided by decided bids.",
      sources: ["Bids"],
      inclusion:
        "Only bids the agency has actually decided. A bid still with them counts on neither side, so waiting does not look like losing.",
    },
  },
  {
    id: "avg_margin",
    label: "Avg margin on wins",
    unit: "percent",
    usesDays: false,
    usesMinScore: false,
    help: "Average profit margin across won bids.",
    provenance: {
      formula: "Mean margin across won bids.",
      sources: ["Bids"],
      inclusion:
        "Only wins that recorded a margin. A win with no margin figure is left out rather than counted as nought.",
    },
  },
  {
    id: "active_contracts",
    label: "Active contracts",
    unit: "count",
    usesDays: false,
    usesMinScore: false,
    help: "Contracts currently under performance tracking.",
    provenance: {
      formula: "Contracts currently being performed.",
      sources: ["Contracts"],
      inclusion:
        "Counted at this moment. Closed and cancelled contracts are excluded.",
    },
  },
  {
    id: "active_contract_revenue",
    label: "Active contract revenue",
    unit: "currency",
    usesDays: false,
    usesMinScore: false,
    help: "Total award value of active contracts.",
    provenance: {
      formula: "Award value of every active contract, added up.",
      sources: ["Contracts"],
      inclusion:
        "Award value as recorded on the contract. Modifications are included where they have been entered.",
    },
  },
];

/**
 * The reported metrics, pinnable.
 *
 * These are the same figures the Reports section computes, reached by the
 * same functions, so a pinned "Trades with a price on them" and the one in
 * the report cannot drift. Their provenance is filled in by the reporting
 * layer at compute time rather than duplicated here, for the same reason.
 */
export const REPORTED_KPI_IDS = [
  "deadline_missed",
  "deadline_on_time_rate",
  "review_decision_days",
  "sub_confirmed_delivery_rate",
  "sub_response_rate",
  "sub_quote_rate",
  "trade_quote_coverage",
  "confidence_measured_coverage",
  "automation_success_rate",
  "automation_recovery_rate",
] as const;

export type ReportedKpiId = (typeof REPORTED_KPI_IDS)[number];

const REPORTED_KPI_DEFS: KpiMetricDef[] = [
  {
    id: "deadline_missed",
    label: "Deadlines missed",
    unit: "count",
    usesDays: true,
    usesMinScore: false,
    help: "Pursued work whose deadline passed with no bid.",
    provenance: REPORTED_PLACEHOLDER("Opportunities", "Bids"),
  },
  {
    id: "deadline_on_time_rate",
    label: "Submitted before the deadline",
    unit: "percent",
    usesDays: true,
    usesMinScore: false,
    help: "Share of passed deadlines the bid actually made.",
    provenance: REPORTED_PLACEHOLDER("Opportunities", "Bids"),
  },
  {
    id: "review_decision_days",
    label: "Time to a pursue or pass decision",
    unit: "days",
    usesDays: true,
    usesMinScore: false,
    help: "Median days from arrival to somebody deciding.",
    provenance: REPORTED_PLACEHOLDER("Opportunities"),
  },
  {
    id: "sub_confirmed_delivery_rate",
    label: "Confirmed as reaching somebody",
    unit: "percent",
    usesDays: true,
    usesMinScore: false,
    help: "Emails with evidence of arrival, not merely sent.",
    provenance: REPORTED_PLACEHOLDER("Communications"),
  },
  {
    id: "sub_response_rate",
    label: "Subcontractors who wrote back",
    unit: "percent",
    usesDays: true,
    usesMinScore: false,
    help: "Share of outbound emails that got a reply.",
    provenance: REPORTED_PLACEHOLDER("Communications"),
  },
  {
    id: "sub_quote_rate",
    label: "Subcontractors who priced the work",
    unit: "percent",
    usesDays: true,
    usesMinScore: false,
    help: "Share of those asked who sent a price.",
    provenance: REPORTED_PLACEHOLDER("Opportunity subcontractors", "Quotes"),
  },
  {
    id: "trade_quote_coverage",
    label: "Trades with a price on them",
    unit: "percent",
    usesDays: true,
    usesMinScore: false,
    help: "Share of sourced trades carrying at least one quote.",
    provenance: REPORTED_PLACEHOLDER("Opportunity subcontractors", "Quotes"),
  },
  {
    id: "confidence_measured_coverage",
    label: "Scores with confidence measured",
    unit: "percent",
    usesDays: true,
    usesMinScore: false,
    help: "How much of the scoring rests on a measured picture.",
    provenance: REPORTED_PLACEHOLDER("Opportunities"),
  },
  {
    id: "automation_success_rate",
    label: "Automation runs that finished cleanly",
    unit: "percent",
    usesDays: true,
    usesMinScore: false,
    help: "Share of automation runs that finished without error.",
    provenance: REPORTED_PLACEHOLDER("Automation runs"),
  },
  {
    id: "automation_recovery_rate",
    label: "Failures the platform recovered from itself",
    unit: "percent",
    usesDays: true,
    usesMinScore: false,
    help: "Share of failures a later run put right.",
    provenance: REPORTED_PLACEHOLDER("Automation runs"),
  },
];

/**
 * Stands in until the metric is computed.
 *
 * The picker needs something to show before any query has run, and the real
 * formula and inclusion rule live beside the query in lib/reporting so there
 * is exactly one copy of each. The computed metric carries the real thing.
 */
function REPORTED_PLACEHOLDER(...sources: string[]): MetricProvenance {
  return {
    formula: "Worked out the same way as the matching figure in Reports.",
    sources,
    inclusion:
      "Identical to the Reports section, so a pinned figure and a reported one can never disagree. Open the card once it has a value to see the full rule.",
  };
}

/** Everything an operator may pin, in one list. */
export const ALL_KPI_METRICS: KpiMetricDef[] = [...KPI_METRICS, ...REPORTED_KPI_DEFS];

export function isReportedKpi(id: string): id is ReportedKpiId {
  return (REPORTED_KPI_IDS as readonly string[]).includes(id);
}

const METRIC_BY_ID = new Map(ALL_KPI_METRICS.map((m) => [m.id, m]));

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
  if (unit === "days") return `${Math.round(value * 10) / 10} ${value === 1 ? "day" : "days"}`;
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
