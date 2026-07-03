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
 * Deterministic hard-exclusion checks. Returns the list of triggered exclusion
 * keys. Any hit means the opportunity is dismissed regardless of dimension
 * scores. Only structured rules are enforced here; free-text rules in the
 * profile are additionally evaluated by Claude.
 */
export function checkHardExclusions(
  opp: Pick<
    Opportunity,
    "set_aside_type" | "value_estimated" | "naics_code" | "deadline"
  >,
  profile: CompanyProfileJson,
  now: Date = new Date()
): string[] {
  const triggered: string[] = [];

  // Ineligible set-aside: requires a cert we don't hold.
  const setAside = (opp.set_aside_type ?? "").toLowerCase();
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

  // Over bonding capacity (>150%).
  if (
    profile.bonding_capacity &&
    opp.value_estimated != null &&
    opp.value_estimated > profile.bonding_capacity * 1.5
  ) {
    triggered.push("over_bonding");
  }

  // Out-of-scope NAICS (no overlap with our codes).
  if (
    opp.naics_code &&
    profile.naics_codes.length &&
    !profile.naics_codes.some((c) => opp.naics_code!.startsWith(c.slice(0, 3)))
  ) {
    // Only a soft signal at the 3-digit level; leave final call to dimension
    // scoring unless there's truly no relation. We do not auto-exclude here to
    // avoid false negatives; adjacency is scored in naics_fit instead.
  }

  // Deadline too soon (<48h) with no analysis started.
  if (opp.deadline) {
    const hrs = (new Date(opp.deadline).getTime() - now.getTime()) / 3_600_000;
    if (hrs >= 0 && hrs < 48) triggered.push("deadline_too_soon");
  }

  return [...new Set(triggered)];
}

function normalizeCert(c: string): string {
  return c.toLowerCase().replace(/[^a-z0-9]/g, "");
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
