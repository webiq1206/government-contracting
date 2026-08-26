/**
 * The acquisition funnel, and what an operator is allowed to conclude from it.
 *
 * The audit names eight steps, `Found -> Scored -> Pursued -> Subs contacted ->
 * Quotes received -> Bid built -> Submitted -> Won or lost`, and asks for
 * conversion rates and time in stage alongside them. Two things make that
 * harder to report honestly than it looks.
 *
 * The first is division by nothing. A funnel step whose predecessor is empty
 * has no conversion rate, and printing `0%` there says the work failed when in
 * fact it never started. Every rate here is `number | null`, and null means
 * "there was nothing to convert", which the page prints in words.
 *
 * The second is time. A cohort of opportunities found last week has not had
 * time to be won or lost, so a funnel drawn over a short window shows a cliff
 * at the end that is not a performance problem at all. The gap between two
 * steps is therefore split: opportunities that stalled and are now closed have
 * genuinely dropped, and opportunities that stalled and are still open have
 * not dropped yet. Reporting those as one number is the difference between
 * "you lose everybody at quoting" and "half of them are quoting right now".
 */

export type FunnelKey =
  | "found"
  | "scored"
  | "pursued"
  | "subs_contacted"
  | "quotes_received"
  | "bid_built"
  | "submitted"
  | "decided";

export interface FunnelStepDef {
  key: FunnelKey;
  label: string;
  /** What reaching this step means in the data, in the operator's words. */
  meaning: string;
  /** Where to go to see the work that sits at this step, or null if nowhere does. */
  href: string | null;
}

export const FUNNEL_STEPS: FunnelStepDef[] = [
  {
    key: "found",
    label: "Found",
    meaning: "Pulled in from a source feed during this period.",
    href: "/pipeline?view=table",
  },
  {
    key: "scored",
    label: "Scored",
    meaning: "Given a fit score, so it could be ranked against the profile.",
    href: "/pipeline?view=table",
  },
  {
    key: "pursued",
    label: "Pursued",
    meaning: "Kept after review and moved past triage.",
    href: "/review",
  },
  {
    key: "subs_contacted",
    label: "Subs contacted",
    meaning: "At least one subcontractor was emailed about it.",
    href: "/communications",
  },
  {
    key: "quotes_received",
    label: "Quotes received",
    meaning: "At least one subcontractor quote is recorded against it.",
    href: "/pipeline?stage=quote_entry",
  },
  {
    key: "bid_built",
    label: "Bid built",
    meaning: "A bid record exists with pricing on it.",
    href: "/pipeline?stage=bid_building",
  },
  {
    key: "submitted",
    label: "Submitted",
    meaning: "The bid was marked submitted to the agency.",
    href: "/pipeline?stage=submitted",
  },
  {
    key: "decided",
    label: "Won or lost",
    // No single page lists won and lost together, and sending somebody to a
    // page that shows half the answer is worse than sending them nowhere. The
    // row prints the split itself instead.
    meaning: "The agency decided, and the outcome is recorded.",
    href: null,
  },
];

export interface FunnelCounts {
  /** How many of the cohort reached each step. Monotonically non-increasing. */
  reached: Record<FunnelKey, number>;
  /** Of those that stopped before a step, how many are closed (a real drop). */
  droppedBefore: Record<FunnelKey, number>;
  /** Of those that stopped before a step, how many are still open (not yet a drop). */
  pendingBefore: Record<FunnelKey, number>;
  /** Median days spent crossing into this step, where a real timestamp exists. */
  medianDaysInto: Partial<Record<FunnelKey, number | null>>;
  won: number;
  lost: number;
}

export interface FunnelStep extends FunnelStepDef {
  count: number;
  /** Share of the previous step that reached this one. Null when the previous step is empty. */
  rateFromPrevious: number | null;
  /** Share of everything found that reached this step. Null when nothing was found. */
  rateFromFound: number | null;
  /** Closed without reaching this step. A genuine loss. */
  dropped: number;
  /** Stopped short of this step but still open, so not yet a loss. */
  pending: number;
  /** Median days to cross into this step, or null when nothing here is timestamped. */
  medianDays: number | null;
}

function rate(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

export function buildFunnel(counts: FunnelCounts): FunnelStep[] {
  const found = counts.reached.found ?? 0;
  return FUNNEL_STEPS.map((def, i) => {
    const prev = i === 0 ? null : FUNNEL_STEPS[i - 1].key;
    const count = counts.reached[def.key] ?? 0;
    return {
      ...def,
      count,
      rateFromPrevious: prev == null ? null : rate(count, counts.reached[prev] ?? 0),
      rateFromFound: i === 0 ? null : rate(count, found),
      dropped: counts.droppedBefore[def.key] ?? 0,
      pending: counts.pendingBefore[def.key] ?? 0,
      medianDays: counts.medianDaysInto[def.key] ?? null,
    };
  });
}

/**
 * The step that loses the most work for good, ignoring anything still in
 * flight. Returned only when there is something to point at: a funnel where
 * nothing has closed yet has no worst step, and inventing one would send
 * somebody to fix a stage that is working.
 */
export function worstDropOff(steps: FunnelStep[]): FunnelStep | null {
  let worst: FunnelStep | null = null;
  for (const s of steps) {
    if (s.dropped <= 0) continue;
    if (!worst || s.dropped > worst.dropped) worst = s;
  }
  return worst;
}

/** Formats a rate that may not exist. Never renders a missing rate as zero. */
export function formatRate(r: number | null): string {
  return r == null ? "No cohort" : `${r}%`;
}

/** Formats a median duration. Never renders "not measured" as "same day". */
export function formatDays(d: number | null): string {
  if (d == null) return "Not recorded";
  if (d < 1) return "Under a day";
  if (d < 2) return "About a day";
  return `${Math.round(d)} days`;
}

// ---------------------------------------------------------------------------
// Date range and comparison
// ---------------------------------------------------------------------------

export type RangeKey = "30" | "90" | "365" | "all";

export const RANGE_OPTIONS: { key: RangeKey; label: string; days: number | null }[] = [
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
  { key: "365", label: "Last 12 months", days: 365 },
  { key: "all", label: "All time", days: null },
];

export function parseRange(v: unknown): RangeKey {
  const s = typeof v === "string" ? v : "";
  return RANGE_OPTIONS.some((o) => o.key === s) ? (s as RangeKey) : "90";
}

export function rangeDays(k: RangeKey): number | null {
  return RANGE_OPTIONS.find((o) => o.key === k)?.days ?? null;
}

export function rangeLabel(k: RangeKey): string {
  return RANGE_OPTIONS.find((o) => o.key === k)?.label ?? "Last 90 days";
}

/** The period a range is compared against, in words. Null when there isn't one. */
export function comparisonLabel(k: RangeKey): string | null {
  const days = rangeDays(k);
  return days == null ? null : `the ${days} days before that`;
}

export interface Delta {
  /** Difference in the counted thing. */
  change: number;
  direction: "up" | "down" | "flat";
  /** Percentage change, or null when the earlier period had nothing to change from. */
  pct: number | null;
}

/**
 * Compares two periods without pretending. Growth from zero has no percentage,
 * and a comparison against a period with no data is not a comparison at all.
 */
export function compare(current: number, previous: number): Delta | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  const change = current - previous;
  return {
    change,
    direction: change > 0 ? "up" : change < 0 ? "down" : "flat",
    pct: previous > 0 ? Math.round((change / previous) * 1000) / 10 : null,
  };
}

/**
 * The comparison in words, with no noun of its own: the caller supplies the
 * label, so the sentence reads correctly whether the thing counted is
 * opportunities, bids or anything else.
 */
export function describeDelta(d: Delta | null, period: string): string | null {
  if (!d) return null;
  if (d.direction === "flat") return `no change from ${period}`;
  const word = d.direction === "up" ? "more" : "fewer";
  const n = Math.abs(d.change);
  const pct = d.pct == null ? "" : ` (${d.pct > 0 ? "+" : ""}${d.pct}%)`;
  return `${n} ${word} than ${period}${pct}`;
}

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

export type Freshness =
  | { state: "never"; label: string; stale: true }
  | { state: "fresh" | "aging" | "stale"; label: string; stale: boolean; ageHours: number };

/** How long ago the stored breakdowns were computed. Older than a week is stale. */
export function snapshotFreshness(generatedAt: Date | string | null, now = new Date()): Freshness {
  const at =
    generatedAt == null
      ? null
      : generatedAt instanceof Date
        ? generatedAt
        : new Date(generatedAt);
  if (!at || Number.isNaN(at.getTime())) {
    return { state: "never", label: "Never computed", stale: true };
  }
  const ageHours = (now.getTime() - at.getTime()) / 3_600_000;
  const label =
    ageHours < 1
      ? "Computed in the last hour"
      : ageHours < 24
        ? `Computed ${Math.round(ageHours)} hour${Math.round(ageHours) === 1 ? "" : "s"} ago`
        : `Computed ${Math.round(ageHours / 24)} day${Math.round(ageHours / 24) === 1 ? "" : "s"} ago`;
  if (ageHours < 36) return { state: "fresh", label, stale: false, ageHours };
  if (ageHours < 24 * 7) return { state: "aging", label, stale: false, ageHours };
  return { state: "stale", label, stale: true, ageHours };
}

// ---------------------------------------------------------------------------
// Drill-down dimensions
// ---------------------------------------------------------------------------

export type BreakdownKey = "naics" | "state" | "agency" | "set_aside" | "score_band";

export const BREAKDOWN_OPTIONS: { key: BreakdownKey; label: string }[] = [
  { key: "agency", label: "Agency" },
  { key: "naics", label: "NAICS" },
  { key: "state", label: "State" },
  { key: "set_aside", label: "Set-aside" },
  { key: "score_band", label: "Score band" },
];

export function parseBreakdown(v: unknown): BreakdownKey {
  const s = typeof v === "string" ? v : "";
  return BREAKDOWN_OPTIONS.some((o) => o.key === s) ? (s as BreakdownKey) : "agency";
}

export function breakdownLabel(k: BreakdownKey): string {
  return BREAKDOWN_OPTIONS.find((o) => o.key === k)?.label ?? "Agency";
}

export interface BreakdownRow {
  key: string;
  found: number;
  pursued: number;
  submitted: number;
  won: number;
  lost: number;
}

export interface BreakdownLine extends BreakdownRow {
  /** Share of found that was pursued. Null only when nothing was found, which cannot happen for a row that exists. */
  pursuitRate: number | null;
  /** Share of pursued that was submitted. Null when nothing was pursued. */
  submissionRate: number | null;
  /** Share of decided bids that were won. Null when nothing has been decided. */
  winRate: number | null;
  /** Bids that are neither won nor lost yet. */
  undecided: number;
}

/**
 * Turns raw per-dimension counts into rates that refuse to lie.
 *
 * The win rate is the one that matters: dividing wins by submissions counts
 * every bid still sitting with the agency as a loss, so it is computed over
 * decided bids only, and a row with nothing decided has no win rate at all.
 */
export function breakdownLines(rows: BreakdownRow[]): BreakdownLine[] {
  return rows.map((r) => {
    const decided = r.won + r.lost;
    return {
      ...r,
      pursuitRate: rate(r.pursued, r.found),
      submissionRate: rate(r.submitted, r.pursued),
      winRate: rate(r.won, decided),
      undecided: Math.max(0, r.submitted - decided),
    };
  });
}
