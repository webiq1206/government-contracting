/**
 * Whether a set of historical awards is actually a benchmark.
 *
 * Pricing Research pulls past federal awards for the opportunity's NAICS (and
 * state when it can) and hands the median downstream as though it were the
 * price of a comparable job. It is used three ways: as the sub-cost proxy for
 * target bid ranges, as the benchmark that flags an individual quote "out of
 * range", and as the bid-level QA gate.
 *
 * That is only sound when the awards resemble each other. A NAICS code is a
 * billing category, not a scope: 811310 ("commercial machinery repair") in
 * Guam covers a $12k inspection contract and a $2M industrial overhaul, and
 * their median means nothing about either. On one live opportunity the middle
 * half of the band alone ran $18,455 to $241,734 while the average sat at 6x
 * the median, and a ±25% tolerance around that median would have flagged a
 * perfectly ordinary quote as out of range.
 *
 * So this module reads the shape of the distribution before anyone prices
 * anything off it, and says plainly when the honest answer is "these numbers
 * cannot tell you what this job costs".
 */

import type { CompStats } from "./pricing";

export type CompReliability = "usable" | "wide" | "unusable";

export interface CompReliabilityRead {
  level: CompReliability;
  /** p75 / p25: how many times wider the top of the middle half is. */
  spreadRatio: number | null;
  /** average / median: how hard a few very large awards pull the mean. */
  skewRatio: number | null;
  /** One plain sentence naming what the numbers show. */
  verdict: string;
  /** What to do about it, given what else is known. */
  guidance: string;
  /**
   * Safe to price or flag against. False means callers must not use the
   * median as a benchmark: no out-of-range flags, no target bids presented
   * as grounded.
   */
  usableAsBenchmark: boolean;
}

/** Below this many awards there is no distribution to read. */
const MIN_COUNT = 5;
/** p75/p25 at or above this means the bucket holds different kinds of work. */
const SPREAD_UNUSABLE = 8;
const SPREAD_WIDE = 3;
/** average/median at or above this means a few outliers dominate the mean. */
const SKEW_UNUSABLE = 3;
const SKEW_WIDE = 1.75;

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function ratio(n: number): string {
  return n >= 10 ? `${Math.round(n)}x` : `${(Math.round(n * 10) / 10).toFixed(1)}x`;
}

export function readCompReliability(
  band: CompStats | null | undefined,
  opts: { incumbentLastAward?: number | null } = {}
): CompReliabilityRead {
  const anchor = opts.incumbentLastAward;
  const anchorLine = anchor && anchor > 0
    ? ` The incumbent's last award of ${money(anchor)} is the closest thing to a real comparable here, so anchor on that.`
    : " Price from the scope and your subcontractor quotes instead.";

  if (!band || band.count <= 0 || band.median <= 0) {
    return {
      level: "unusable",
      spreadRatio: null,
      skewRatio: null,
      verdict: "No comparable awards were found for this work.",
      guidance: `Nothing here can tell you what this job should cost.${anchorLine}`,
      usableAsBenchmark: false,
    };
  }

  const spreadRatio =
    band.p25 > 0 ? Math.round((band.p75 / band.p25) * 100) / 100 : null;
  const skewRatio =
    band.median > 0 ? Math.round((band.average / band.median) * 100) / 100 : null;

  if (band.count < MIN_COUNT) {
    return {
      level: "unusable",
      spreadRatio,
      skewRatio,
      verdict: `Only ${band.count} comparable award${band.count === 1 ? "" : "s"} were found, too few to read a typical price from.`,
      guidance: `Treat the numbers below as background, not a target.${anchorLine}`,
      usableAsBenchmark: false,
    };
  }

  const reasons: string[] = [];
  if (spreadRatio != null && spreadRatio >= SPREAD_WIDE) {
    reasons.push(
      `the middle half alone runs ${money(band.p25)} to ${money(band.p75)} (${ratio(spreadRatio)})`
    );
  }
  if (skewRatio != null && skewRatio >= SKEW_WIDE) {
    reasons.push(`the average is ${ratio(skewRatio)} the median`);
  }

  const unusable =
    (spreadRatio != null && spreadRatio >= SPREAD_UNUSABLE) ||
    (skewRatio != null && skewRatio >= SKEW_UNUSABLE);

  if (unusable) {
    return {
      level: "unusable",
      spreadRatio,
      skewRatio,
      verdict: `These ${band.count} awards are not comparable to each other: ${reasons.join(", and ")}. This category mixes very different jobs, so the band cannot say what this one should cost.`,
      guidance: `Do not price off the median.${anchorLine}`,
      usableAsBenchmark: false,
    };
  }

  if (reasons.length > 0) {
    return {
      level: "wide",
      spreadRatio,
      skewRatio,
      verdict: `${band.count} comparable awards, but spread out: ${reasons.join(", and ")}.`,
      guidance:
        "Use the band as a sanity check on the order of magnitude, not as a target price.",
      usableAsBenchmark: false,
    };
  }

  return {
    level: "usable",
    spreadRatio,
    skewRatio,
    verdict: `${band.count} comparable awards clustered tightly enough to price against: most land between ${money(band.p25)} and ${money(band.p75)}.`,
    guidance: `A bid near ${money(band.median)} is in normal territory for this kind of work.`,
    usableAsBenchmark: true,
  };
}

/**
 * The benchmark a caller may flag prices against, or null when the comp set
 * cannot carry that weight. Every out-of-range decision should come through
 * here rather than reading the median directly.
 */
export function benchmarkFor(
  band: CompStats | null | undefined,
  opts: { incumbentLastAward?: number | null } = {}
): number | null {
  const read = readCompReliability(band, opts);
  if (read.usableAsBenchmark && band && band.median > 0) return band.median;
  // An incumbent's award on this exact recompete is a real comparable even
  // when the category around it is noise.
  const anchor = opts.incumbentLastAward;
  return anchor != null && anchor > 0 ? anchor : null;
}
