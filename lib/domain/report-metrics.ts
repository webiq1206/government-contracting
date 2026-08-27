/**
 * The reported metrics, and what each one is allowed to claim.
 *
 * Two rules shape this file, both learned the expensive way elsewhere in this
 * codebase.
 *
 * A metric with no records behind it is null, never nought. "We have never
 * submitted a bid" and "we submit nothing" are different facts, and a card
 * that prints 0% for the first is telling somebody their process is broken
 * when it has simply not run yet.
 *
 * A metric that cannot say where it came from is a number somebody has to take
 * on trust, and the first time it disagrees with a spreadsheet it loses. So
 * provenance is part of the type: a metric cannot be added to this file
 * without saying how it is worked out, which records it reads, and what it
 * leaves out.
 *
 * Pure. The caller gathers the facts; this decides what they mean.
 */

export type MetricUnit = "percent" | "count" | "days" | "currency";

export interface MetricProvenance {
  /** How the figure is worked out, in words somebody can check against. */
  formula: string;
  /** The records it reads. Named as an operator would name them. */
  sources: string[];
  /** What is counted, and what is deliberately left out. */
  inclusion: string;
}

export interface Metric {
  key: string;
  label: string;
  /** Null when there is nothing to measure. Never a stand-in zero. */
  value: number | null;
  unit: MetricUnit;
  /** Why the value is null, in a sentence, when it is. */
  absent: string | null;
  /**
   * How many records carry what the figure needs, out of how many are in
   * scope. Null when the question does not apply.
   */
  coverage: { have: number; need: number } | null;
  provenance: MetricProvenance;
}

/** A metric that has a value, or a stated reason it does not. */
export function metric(
  key: string,
  label: string,
  unit: MetricUnit,
  value: number | null,
  absent: string,
  provenance: MetricProvenance,
  coverage: { have: number; need: number } | null = null
): Metric {
  return { key, label, unit, value, absent: value == null ? absent : null, coverage, provenance };
}

/** A share, or null when the denominator is empty. Never 0/0 as nought. */
export function share(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

// ---------------------------------------------------------------------------
// Value: known, modeled, unknown
// ---------------------------------------------------------------------------

/**
 * Where a dollar figure came from, which decides what may be said about it.
 *
 * Federal notices routinely publish no value at all. Summing only the ones
 * that do and calling it "pipeline value" understates the pipeline; filling
 * the rest in from a model and adding them to the same total overstates it,
 * and worse, hides which is which. So the three are counted apart and
 * presented apart.
 */
export type ValueBasis = "known" | "modeled" | "unknown";

/**
 * The sources that count as published rather than inferred.
 *
 * `analysis` is the model reading the solicitation, which is a good guess and
 * still a guess. Anything unrecognized is treated as modeled rather than
 * known: an unfamiliar source is not evidence, and defaulting the other way
 * would let a new writer quietly promote its guesses to fact.
 */
const KNOWN_SOURCES = new Set(["sam", "sam_gov", "notice", "published", "operator", "award"]);

export function valueBasis(
  cents: number | null | undefined,
  source: string | null | undefined
): ValueBasis {
  if (cents == null || !Number.isFinite(cents) || cents <= 0) return "unknown";
  const s = (source ?? "").trim().toLowerCase();
  if (s === "") return "unknown";
  return KNOWN_SOURCES.has(s) ? "known" : "modeled";
}

export interface ValueSplit {
  /** Published by the notice or entered by a person. */
  known: { count: number; total: number };
  /** Inferred, by the analyst or a comparable. Real, and not the same thing. */
  modeled: { count: number; total: number };
  /** No figure at all. Counted, never valued, and never added in as nought. */
  unknown: { count: number };
}

export interface ValueRow {
  cents: number | null;
  source: string | null;
}

export function splitValue(rows: ValueRow[]): ValueSplit {
  const out: ValueSplit = {
    known: { count: 0, total: 0 },
    modeled: { count: 0, total: 0 },
    unknown: { count: 0 },
  };
  for (const r of rows) {
    const basis = valueBasis(r.cents, r.source);
    if (basis === "unknown") out.unknown.count += 1;
    else {
      out[basis].count += 1;
      out[basis].total += r.cents ?? 0;
    }
  }
  return out;
}

/**
 * What a total may honestly be called, given how much of the set it covers.
 *
 * Deliberately a sentence rather than a percentage: "from 2 of 41 that publish
 * one" tells an operator what to do about it, and "5% coverage" does not.
 */
export function coverageSentence(split: ValueSplit): string {
  const valued = split.known.count + split.modeled.count;
  const total = valued + split.unknown.count;
  if (total === 0) return "Nothing in range yet.";
  if (split.unknown.count === 0 && split.modeled.count === 0) {
    return "Every one of these publishes a value.";
  }
  const parts: string[] = [];
  if (split.known.count > 0) parts.push(`${split.known.count} published a value`);
  if (split.modeled.count > 0) parts.push(`${split.modeled.count} were estimated`);
  if (split.unknown.count > 0) parts.push(`${split.unknown.count} carry no figure at all`);
  return `Of ${total}, ${parts.join(", ")}.`;
}

/**
 * Pipeline value weighted by the rate at which bids are actually won.
 *
 * A forecast, and labelled as one wherever it appears. It is the only number
 * on the page derived from another number rather than counted, which is
 * exactly why it is kept out of the known and modeled totals rather than
 * folded into them.
 *
 * Null when there is no win rate to weight by. An expected value computed
 * against an assumed win rate is a made-up number wearing a real one's
 * clothes, and this product does not print those.
 */
export function expectedValue(
  openValueCents: number,
  winRatePercent: number | null
): number | null {
  if (winRatePercent == null || !Number.isFinite(winRatePercent)) return null;
  if (!Number.isFinite(openValueCents) || openValueCents <= 0) return null;
  return Math.round(openValueCents * (winRatePercent / 100));
}
