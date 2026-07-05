/**
 * Scoring domain logic — pure and deterministic (unit-tested). The Scoring
 * Engine agent uses these to (1) check hard exclusions FIRST, (2) tier a total
 * score. The per-dimension point judgement is produced by Claude against the
 * rubric; the arithmetic and thresholds live here.
 */
import type {
  CompanyProfileJson,
  Opportunity,
  ScoreBreakdown,
  Tier,
} from "../types";

export interface DimensionScore {
  key: string;
  label: string;
  points: number;
  max_points: number;
  reasoning: string;
}

export function assignTier(
  total: number,
  thresholds: { pursue_min_score: number; review_min_score: number }
): Tier {
  if (total >= thresholds.pursue_min_score) return "pursue";
  if (total >= thresholds.review_min_score) return "review";
  return "dismiss";
}

export function sumDimensions(dims: DimensionScore[]): number {
  return dims.reduce((acc, d) => acc + clamp(d.points, 0, d.max_points), 0);
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Deterministic hard-exclusion (auto-dismiss) checks — Company Profile §7.
 * Returns the list of triggered exclusion keys. Any hit means auto-dismiss
 * regardless of dimension scores. Free-text rules are additionally evaluated by
 * Claude. Note: "NAICS not in active list", "construction >$150K w/o past perf",
 * and "past performance prime-only" are FLAG-for-review (not dismiss) and are
 * handled by the scoring/analysis flow, not here.
 */
export function checkHardExclusions(
  opp: Pick<
    Opportunity,
    "set_aside_type" | "value_estimated" | "naics_code" | "deadline" | "title" | "description"
  >,
  profile: CompanyProfileJson,
  now: Date = new Date()
): string[] {
  const triggered: string[] = [];
  const t = profile.decision_thresholds;
  const text = `${opp.title ?? ""}\n${opp.description ?? ""}`.toLowerCase();
  const setAside = (opp.set_aside_type ?? "").toLowerCase();
  const isUnrestricted =
    setAside === "" ||
    setAside.includes("unrestricted") ||
    setAside.includes("full and open") ||
    setAside === "n/a" ||
    setAside === "none";

  // Value below minimum ($50K): margin per hour of effort too low.
  const min = t.value_min ?? 50_000;
  if (opp.value_estimated != null && opp.value_estimated < min) {
    triggered.push("value_below_min");
  }

  // Unrestricted below $150K: competition density too high.
  const unrestrictedMin = t.unrestricted_min_value ?? 150_000;
  if (isUnrestricted && opp.value_estimated != null && opp.value_estimated < unrestrictedMin) {
    triggered.push("unrestricted_under_threshold");
  }

  // Security clearance required (keyword scan).
  if (/\b(top[-\s]?secret|ts\/sci|secret clearance|security clearance required|active clearance)\b/.test(text)) {
    triggered.push("security_clearance");
  }

  // Licensed professional / stamped deliverables required.
  if (/(professional engineer|\bpe stamp\b|engineering stamp|engineer'?s stamp|architect(ural)? stamp|licensed (professional )?(engineer|architect)|stamped (drawings|plans|deliverables))/.test(text)) {
    triggered.push("licensed_professional");
  }

  // Ineligible set-aside: requires a certification we don't hold.
  const held = new Set(profile.certifications.map((c) => normalizeCert(c)));
  const CERT_KEYWORDS: Record<string, string> = {
    "8(a)": "8a",
    "8a": "8a",
    sdvosb: "sdvosb",
    "service-disabled": "sdvosb",
    wosb: "wosb",
    "women-owned": "wosb",
    edwosb: "edwosb",
    hubzone: "hubzone",
    vosb: "vosb",
  };
  for (const [kw, cert] of Object.entries(CERT_KEYWORDS)) {
    if (setAside.includes(kw) && !held.has(cert)) {
      triggered.push("ineligible_set_aside");
      break;
    }
  }

  // Deadline too soon (< min days) OR already past: insufficient time for sub
  // research + quotes. A past deadline (days < 0) is the most insufficient case,
  // so it must trigger too — not be skipped.
  const minDays = t.deadline_min_days ?? 7;
  if (opp.deadline) {
    const days = (new Date(opp.deadline).getTime() - now.getTime()) / 86_400_000;
    if (days < minDays) triggered.push("deadline_too_soon");
  }

  return [...new Set(triggered)];
}

function normalizeCert(c: string): string {
  return c.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Reconcile the model's returned dimension scores against the FULL rubric.
 * Iterating the rubric (not the model output) guarantees every dimension is
 * represented, so a dimension the model omits can never silently drop points
 * from the total. Returns the reconciled dimensions plus the rubric keys the
 * model failed to score — the caller should route an incomplete scoring to human
 * review rather than trusting a partial total for auto-pursue/auto-dismiss.
 */
export function reconcileDimensions(
  rubricDims: { key: string; label: string; max_points: number }[],
  scored: { key: string; points: number; reasoning: string }[]
): { dims: DimensionScore[]; missingKeys: string[] } {
  const byKey = new Map(scored.map((s) => [s.key, s]));
  const missingKeys: string[] = [];
  const dims: DimensionScore[] = rubricDims.map((rd) => {
    const s = byKey.get(rd.key);
    if (!s) missingKeys.push(rd.key);
    return {
      key: rd.key,
      label: rd.label,
      points: s ? clamp(Math.round(s.points), 0, rd.max_points) : 0,
      max_points: rd.max_points,
      reasoning: s?.reasoning ?? "Not scored by the model — treated as 0, flagged for review.",
    };
  });
  return { dims, missingKeys };
}

/**
 * Apply an operator-approved `scoring_weights` row (produced by the Learning
 * Loop) to the rubric by overriding each dimension's max_points, then normalize
 * back to the rubric's original total so the pursue/review thresholds (which
 * assume a 100-point scale) remain valid regardless of the raw weights proposed.
 * With no active weights, the rubric is returned unchanged (default behavior).
 * `weights` is the shape stored by the Learning Loop: { [key]: { weight } }.
 */
export function applyWeightOverrides<
  D extends { key: string; label: string; max_points: number },
>(rubricDims: D[], weights: Record<string, unknown> | null | undefined): D[] {
  if (!weights || Object.keys(weights).length === 0) return rubricDims;
  const rawOf = (d: D): number => {
    const w = weights[d.key] as { weight?: unknown } | undefined;
    return w && typeof w.weight === "number" && w.weight >= 0 ? w.weight : d.max_points;
  };
  const originalTotal = rubricDims.reduce((a, d) => a + d.max_points, 0) || 100;
  const rawTotal = rubricDims.reduce((a, d) => a + rawOf(d), 0) || 1;
  return rubricDims.map((d) => ({
    ...d,
    max_points: Math.round((rawOf(d) / rawTotal) * originalTotal),
  }));
}

/**
 * Non-dismiss "flag for review" checks (Company Profile). Unlike hard exclusions
 * these do NOT zero the score — they force an otherwise-pursue opportunity into
 * human review instead of unconditional auto-pursue. Currently: contract value
 * above value_max (the company is too new to self-approve a contract this large).
 */
export function reviewFlags(
  opp: Pick<Opportunity, "value_estimated">,
  profile: CompanyProfileJson
): string[] {
  const flags: string[] = [];
  const max = profile.decision_thresholds.value_max;
  if (max != null && opp.value_estimated != null && opp.value_estimated > max) {
    flags.push("value_over_max");
  }
  return flags;
}

/** Assemble a full ScoreBreakdown from dimension scores + exclusions. */
export function buildScoreBreakdown(
  dims: DimensionScore[],
  exclusions: string[],
  profile: CompanyProfileJson,
  summary: string
): ScoreBreakdown {
  const total = exclusions.length ? 0 : sumDimensions(dims);
  const tier: Tier = exclusions.length
    ? "dismiss"
    : assignTier(total, profile.decision_thresholds);
  return {
    total,
    tier,
    hard_exclusions_triggered: exclusions,
    dimensions: dims.map((d) => ({ ...d, points: clamp(d.points, 0, d.max_points) })),
    summary,
  };
}
