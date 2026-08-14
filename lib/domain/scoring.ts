/**
 * Scoring domain logic, pure and deterministic (unit-tested). The Scoring
 * Engine agent uses these to (1) check hard exclusions FIRST, (2) tier a total
 * score. The per-dimension point judgement is produced by Claude against the
 * rubric; the arithmetic and thresholds live here.
 */
import { serviceAreaStateCodes } from "../us-states";
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
 * Deterministic hard-exclusion (auto-dismiss) checks, Company Profile §7.
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

  // Security clearance required. Negation-aware: solicitations routinely say
  // "no clearance is required", and matching the bare phrase dismissed them.
  if (requirementMentioned(text, /top[-\s]?secret|ts\/sci|secret clearance|security clearance|active clearance/g)) {
    triggered.push("security_clearance");
  }

  // Licensed professional / stamped deliverables required.
  if (
    requirementMentioned(
      text,
      /professional engineer|\bpe stamp\b|engineering stamp|engineer'?s stamp|architect(?:ural)? stamp|licensed (?:professional )?(?:engineer|architect)|stamped (?:drawings|plans|deliverables)/g
    )
  ) {
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
  // so it must trigger too, not be skipped.
  const minDays = t.deadline_min_days ?? 7;
  if (opp.deadline) {
    const days = (new Date(opp.deadline).getTime() - now.getTime()) / 86_400_000;
    if (days < minDays) triggered.push("deadline_too_soon");
  }

  return [...new Set(triggered)];
}

/**
 * Whether a requirement is genuinely imposed, rather than merely mentioned.
 *
 * These two checks auto-dismiss an opportunity outright, so a bare keyword
 * scan is the wrong instrument: federal solicitations say "no security
 * clearance is required" and "architect stamp not required" constantly, and
 * matching the phrase inside those sentences threw away work the customer
 * could have won, silently and with no way to notice.
 *
 * Each match is read in context. A negation close before it ("no", "not",
 * "without", "waived") or a negated qualifier close after it ("not required",
 * "is not needed") means the document is saying the opposite, and the match is
 * discarded. Anything still standing is treated as a real requirement.
 *
 * Deliberately conservative in one direction only: an unusual phrasing that
 * slips past leaves an opportunity in the pipeline for a human to reject,
 * which costs a moment. The failure it prevents costs the bid.
 */
export function requirementMentioned(text: string, pattern: RegExp): boolean {
  const NEGATION_BEFORE = /\b(no|not|non|without|never|excluding|excluded|waived|waives?)\b[^.]{0,40}$/;
  const NEGATION_AFTER = /^[^.]{0,40}\b(not required|not needed|is not|are not|isn't|aren't|waived|not necessary)\b/;
  /**
   * The phrase alone is not a requirement. "Work will be inspected by the
   * government's professional engineer" names someone else's engineer, and
   * dismissing on it threw away ordinary construction work. So an obligation
   * has to be stated nearby for the match to count.
   */
  // `requir\w*` on purpose: require, requires, required, requiring, and
  // requirement all state the same obligation, and listing only some of them
  // let "Deliverables require a PE stamp" read as a passing mention.
  // Negation is checked first, so "does not require" is already discarded.
  const OBLIGATION = /\b(must|shall|requir\w*|mandator\w*|responsible for|expected to)\b/;
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    const before = text.slice(Math.max(0, at - 60), at);
    const after = text.slice(at + m[0].length, at + m[0].length + 60);
    if (NEGATION_BEFORE.test(before)) continue;
    if (NEGATION_AFTER.test(after)) continue;
    // Sentence-local: an obligation two paragraphs away is about something
    // else. The window is the same one the negation checks read.
    if (!OBLIGATION.test(before) && !OBLIGATION.test(after)) continue;
    return true;
  }
  return false;
}

function normalizeCert(c: string): string {
  return c.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Reconcile the model's returned dimension scores against the FULL rubric.
 * Iterating the rubric (not the model output) guarantees every dimension is
 * represented, so a dimension the model omits can never silently drop points
 * from the total. Returns the reconciled dimensions plus the rubric keys the
 * model failed to score, the caller should route an incomplete scoring to human
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
      reasoning: s?.reasoning ?? "Not scored by the model, treated as 0, flagged for review.",
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
  const rawTotal = rubricDims.reduce((a, d) => a + rawOf(d), 0);
  /**
   * A weighting that sums to nothing carries no information, so the rubric is
   * returned untouched.
   *
   * Without this the normalization divided by a substituted 1, every dimension
   * floored to zero, and the largest-remainder pass could only hand back one
   * point per dimension: a 100 point rubric became a 10 point one. Nothing
   * failed. Scores simply collapsed below a threshold that still assumed 100,
   * and every opportunity was dismissed.
   */
  if (rawTotal <= 0) return rubricDims;
  // Largest-remainder rounding so the normalized max_points sum EXACTLY to the
  // original total. Plain Math.round can produce 99 or 101, which silently
  // shifts the pursue/review thresholds (they assume the original scale).
  const exact = rubricDims.map((d) => (rawOf(d) / rawTotal) * originalTotal);
  const floors = exact.map((v) => Math.floor(v));
  let remainder = originalTotal - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - floors[i] }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] += 1;
    remainder -= 1;
  }
  return rubricDims.map((d, i) => ({ ...d, max_points: floors[i] }));
}

/**
 * Non-dismiss "flag for review" checks (Company Profile). Unlike hard exclusions
 * these do NOT zero the score, they force an otherwise-pursue opportunity into
 * human review instead of unconditional auto-pursue. Currently: contract value
 * above value_max (the company is too new to self-approve a contract this large).
 */
export function reviewFlags(
  opp: Pick<Opportunity, "value_estimated" | "location_state">,
  profile: CompanyProfileJson
): string[] {
  const flags: string[] = [];
  const max = profile.decision_thresholds.value_max;
  if (max != null && opp.value_estimated != null && opp.value_estimated > max) {
    flags.push("value_over_max");
  }
  if (serviceAreaFit(opp.location_state, profile.service_areas) === "mismatch") {
    flags.push("out_of_service_area");
  }
  return flags;
}

/**
 * Deterministic geographic fit between an opportunity's place of performance and
 * the company's service areas. Returns:
 *   - "unknown"  when we can't judge (no PoP state, or the company is nationwide
 *                / has no usable service areas) — never penalize on uncertainty.
 *   - "fit"      when the PoP state is within the company's service areas.
 *   - "mismatch" when the company is regional and the PoP state is outside it.
 * A mismatch is a REVIEW flag (downgrades auto-pursue to human review), not a
 * hard exclusion, so a valid out-of-area opportunity is surfaced, never dropped.
 */
export function serviceAreaFit(
  locationState: string | null | undefined,
  serviceAreas: string[] | null | undefined
): "fit" | "mismatch" | "unknown" {
  const codes = serviceAreaStateCodes(serviceAreas); // null = nationwide / none
  if (!codes) return "unknown";
  const loc = (locationState ?? "").trim().toUpperCase();
  if (!loc) return "unknown"; // no place of performance to compare against
  return codes.has(loc) ? "fit" : "mismatch";
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
