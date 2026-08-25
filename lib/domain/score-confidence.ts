/**
 * How much of a score rests on facts we actually have.
 *
 * A score is a judgement about a solicitation. It was being presented as
 * though the solicitation were fully known, and federal notices are routinely
 * not: most publish no estimated value at all, many arrive as a title and a
 * link, and some are scanned images with no extractable text. The model was
 * still asked to score every dimension, and it obliged -- so "Contract value
 * inside your band" collected points on a contract whose value nobody knew,
 * and the resulting total looked exactly like one computed from a complete
 * document.
 *
 * Two numbers answer two different questions, and conflating them is what
 * made the first one untrustworthy:
 *
 *   Fit score      -- how well this matches the company, given what we know.
 *   Data confidence -- how much we know.
 *
 * A 78 on a solicitation we have read in full is a reason to bid. A 78 on a
 * title and a NAICS code is a reason to go and read the notice. Same number,
 * opposite instruction, and the operator could not tell them apart.
 *
 * Pure: the caller gathers the facts, this decides what they mean.
 */

/** A score-relevant fact, and whether the record actually carries it. */
export interface ScoreFacts {
  /** A published or extracted dollar value. Absent on most federal notices. */
  valueKnown: boolean;
  /** A primary NAICS code on the notice. */
  naicsKnown: boolean;
  /** The set-aside type (or an explicit "unrestricted"). */
  setAsideKnown: boolean;
  /** A response deadline. */
  deadlineKnown: boolean;
  /** Place of performance, at least to the state. */
  locationKnown: boolean;
  /** Enough scope text to judge the work, from the notice or its attachments. */
  scopeKnown: boolean;
  /** Whether the past-performance requirement could be determined either way. */
  pastPerformanceKnown: boolean;
}

export type ConfidenceLevel = "high" | "medium" | "low";

export interface DataConfidence {
  level: ConfidenceLevel;
  /** 0-100, the share of weighted facts present. */
  percent: number;
  /** Facts we have, in plain English. */
  known: string[];
  /** Facts we do not, in plain English. The operator's reading list. */
  unknown: string[];
  /** One sentence, safe to render as-is. */
  summary: string;
}

/**
 * Weights reflect how much a missing fact damages the score's meaning, not how
 * much of the notice it represents. Scope is the heaviest: without it we are
 * scoring a headline. Value is second, because it drives both the band
 * dimension and the pursue/pass economics.
 */
const FACT_WEIGHTS: { key: keyof ScoreFacts; label: string; weight: number }[] = [
  { key: "scopeKnown", label: "what the work actually is", weight: 30 },
  { key: "valueKnown", label: "the contract value", weight: 20 },
  { key: "naicsKnown", label: "the NAICS code", weight: 15 },
  { key: "pastPerformanceKnown", label: "whether past performance is required", weight: 12 },
  { key: "setAsideKnown", label: "the set-aside type", weight: 10 },
  { key: "deadlineKnown", label: "the response deadline", weight: 8 },
  { key: "locationKnown", label: "where the work is", weight: 5 },
];

export function assessDataConfidence(facts: ScoreFacts): DataConfidence {
  const known: string[] = [];
  const unknown: string[] = [];
  let have = 0;
  let total = 0;

  for (const f of FACT_WEIGHTS) {
    total += f.weight;
    if (facts[f.key]) {
      have += f.weight;
      known.push(f.label);
    } else {
      unknown.push(f.label);
    }
  }

  const percent = total === 0 ? 0 : Math.round((have / total) * 100);
  const level: ConfidenceLevel = percent >= 80 ? "high" : percent >= 50 ? "medium" : "low";

  const summary =
    unknown.length === 0
      ? "Every fact this score depends on was found in the solicitation."
      : level === "low"
        ? `Most of this notice is still unknown: ${unknown.slice(0, 3).join(", ")}. Read the solicitation before trusting the score.`
        : `Scored without ${unknown.slice(0, 3).join(", ")}${unknown.length > 3 ? `, and ${unknown.length - 3} more` : ""}.`;

  return { level, percent, known, unknown, summary };
}

/**
 * Which rubric dimension depends on which fact.
 *
 * Only dimensions whose meaning collapses without a specific fact are listed.
 * A dimension judged from scope text alone is not capped here, because scope
 * absence is already reflected in the confidence figure.
 */
const DIMENSION_REQUIRES: Record<string, keyof ScoreFacts> = {
  value_in_band: "valueKnown",
  naics_active: "naicsKnown",
  sb_setaside_match: "setAsideKnown",
  pp_not_required: "pastPerformanceKnown",
  deadline_runway: "deadlineKnown",
};

/**
 * The ceiling a dimension may score when its underlying fact is missing.
 *
 * Not zero, deliberately. Zero is itself a claim -- "this opportunity fails
 * on value" -- and an unknown value is not a failure, it is an unknown; a
 * hard zero would push perfectly good notices below the dismiss threshold on
 * a fact that was never published. Half admits the uncertainty in both
 * directions and keeps the record in front of a human, which is exactly where
 * a partially-read solicitation belongs.
 */
const UNKNOWN_FACT_CEILING = 0.5;

export interface ScoredDimension {
  key: string;
  label: string;
  points: number;
  max_points: number;
  reasoning: string;
}

/**
 * Cap any dimension the facts cannot support, and say so in its reasoning.
 *
 * The model is asked to score the full rubric because an omitted dimension
 * silently understates the total (see reconcileDimensions). That means it
 * WILL return a number for "Contract value inside your band" on a notice with
 * no value in it, and it will write a confident sentence underneath. This is
 * the check that the number was earned.
 */
export function capUnsupportedDimensions(
  dims: ScoredDimension[],
  facts: ScoreFacts
): { dims: ScoredDimension[]; capped: string[] } {
  const capped: string[] = [];
  const out = dims.map((d) => {
    const needs = DIMENSION_REQUIRES[d.key];
    if (!needs || facts[needs]) return d;

    const ceiling = Math.floor(d.max_points * UNKNOWN_FACT_CEILING);
    if (d.points <= ceiling) return d;

    capped.push(d.key);
    const factLabel =
      FACT_WEIGHTS.find((f) => f.key === needs)?.label ?? "a required fact";
    return {
      ...d,
      points: ceiling,
      reasoning:
        `Capped at ${ceiling} of ${d.max_points}: ${factLabel} is not stated in this notice, ` +
        `so full marks could not be earned. Original reading: ${d.reasoning}`,
    };
  });
  return { dims: out, capped };
}
