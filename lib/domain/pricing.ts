/**
 * Pricing domain logic, pure and deterministic (unit-tested). Bid math,
 * margin/markup conversions, CPI inflation adjustment, and out-of-range
 * detection against historical comps.
 */

/** Bid amount from sub cost and markup %. markup is on cost: bid = cost * (1+m). */
export function bidFromMarkup(subCost: number, markupPct: number): number {
  return round2(subCost * (1 + markupPct / 100));
}

/** Margin % of the resulting bid (profit / bid). */
export function marginFromBid(subCost: number, bidAmount: number): number {
  if (bidAmount <= 0) return 0;
  return round2(((bidAmount - subCost) / bidAmount) * 100);
}

/** Markup % required to hit a target margin %. margin = (bid-cost)/bid. */
export function markupForTargetMargin(targetMarginPct: number): number {
  const m = targetMarginPct / 100;
  if (m >= 1) return Infinity;
  // bid = cost/(1-m); markup = bid/cost - 1 = m/(1-m)
  return round2((m / (1 - m)) * 100);
}

/** Bid to hit a target margin from sub cost. */
export function bidForTargetMargin(subCost: number, targetMarginPct: number): number {
  const m = targetMarginPct / 100;
  if (m >= 1) return Infinity;
  return round2(subCost / (1 - m));
}

export interface MarginScenario {
  margin_pct: number;
  bid_amount: number;
  markup_pct: number;
  profit: number;
}

/** Model each margin scenario from the profile for a given sub cost. */
export function marginScenarios(subCost: number, marginPcts: number[]): MarginScenario[] {
  return marginPcts.map((margin) => {
    const bid = bidForTargetMargin(subCost, margin);
    return {
      margin_pct: margin,
      bid_amount: bid,
      markup_pct: markupForTargetMargin(margin),
      profit: round2(bid - subCost),
    };
  });
}

/**
 * CPI inflation adjustment. Given a nominal amount from `fromYear`, adjust to
 * `toYear` dollars using an index map { year: cpiIndex }. If either year is
 * missing, returns the original amount unchanged.
 */
export function cpiAdjust(
  amount: number,
  fromYear: number,
  toYear: number,
  cpiByYear: Record<number, number>
): number {
  const from = cpiByYear[fromYear];
  const to = cpiByYear[toYear];
  if (!from || !to) return round2(amount);
  return round2(amount * (to / from));
}

export interface CompStats {
  count: number;
  average: number;
  median: number;
  p25: number;
  p75: number;
}

/** Summary statistics for a set of (adjusted) comparable award amounts. */
export function compStats(values: number[]): CompStats {
  const v = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (v.length === 0) return { count: 0, average: 0, median: 0, p25: 0, p75: 0 };
  const sum = v.reduce((a, b) => a + b, 0);
  return {
    count: v.length,
    average: round2(sum / v.length),
    median: percentile(v, 50),
    p25: percentile(v, 25),
    p75: percentile(v, 75),
  };
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return round2(sorted[lo]);
  const frac = rank - lo;
  return round2(sorted[lo] * (1 - frac) + sorted[hi] * frac);
}

/**
 * Is a bid out of range vs a comp benchmark (e.g. median), beyond ±tolerance%?
 */
export function isOutOfRange(
  bidAmount: number,
  benchmark: number,
  tolerancePct: number
): { outOfRange: boolean; deltaPct: number } {
  if (benchmark <= 0) return { outOfRange: false, deltaPct: 0 };
  const deltaPct = round2(((bidAmount - benchmark) / benchmark) * 100);
  return { outOfRange: Math.abs(deltaPct) > tolerancePct, deltaPct };
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface QuoteForSelection {
  id: string;
  subcontractor_id: string | null;
  trade: string | null;
  quote_amount: number;
}

export interface QuoteSelection {
  /** Exactly one quote per trade: what the bid is priced and written from. */
  selected: QuoteForSelection[];
  /** Everything else, kept so the comparison is not thrown away. */
  alternates: QuoteForSelection[];
  /** Trades where more than one sub quoted, so a choice had to be made. */
  contestedTrades: string[];
}

/**
 * Choose which quotes a bid is built from: one per trade.
 *
 * The whole outreach workflow exists to collect competing quotes for the same
 * trade, so an opportunity normally holds several. Adding them all up prices
 * the job as if every bidder were hired at once. Three electricians quoting
 * one scope produced a bid three electricians wide, and the generated document
 * listed each of them as its own line item for the agency to read.
 *
 * The lowest quote per trade is taken, which is the competitive default and,
 * unlike summing, can never overstate the cost. It is a default and not a
 * verdict: the alternates come back with it, and `contestedTrades` names every
 * trade where a choice was made so the bid can be held for a human before it
 * goes anywhere.
 *
 * Quotes with no trade are grouped together under one heading. That is a
 * guess, and the group is reported as contested whenever it holds more than
 * one quote so somebody confirms it rather than the bid quietly assuming.
 */
export function selectQuotesForBid(quotes: QuoteForSelection[]): QuoteSelection {
  const UNTRADED = "(no trade given)";
  const groups = new Map<string, QuoteForSelection[]>();
  for (const q of quotes) {
    const key = (q.trade ?? "").trim().toLowerCase() || UNTRADED;
    const bucket = groups.get(key);
    if (bucket) bucket.push(q);
    else groups.set(key, [q]);
  }

  const selected: QuoteForSelection[] = [];
  const alternates: QuoteForSelection[] = [];
  const contestedTrades: string[] = [];

  for (const [key, bucket] of groups) {
    // Stable: an exact tie keeps whichever arrived first rather than
    // reordering the bid between runs on identical data.
    const ranked = [...bucket].sort((a, b) => a.quote_amount - b.quote_amount);
    selected.push(ranked[0]);
    if (ranked.length > 1) {
      alternates.push(...ranked.slice(1));
      contestedTrades.push(key === UNTRADED ? UNTRADED : (ranked[0].trade ?? key));
    }
  }

  return { selected, alternates, contestedTrades };
}

/**
 * The priced scope as the AGENCY sees it.
 *
 * The submitted pricing schedule listed each subcontractor quote at cost and
 * then a separate line reading "Markup 18.5% (prices to 22% target margin)".
 * That hands the contracting officer our cost basis, our markup, and our
 * margin policy, on the document they use to evaluate price and negotiate.
 * An offer states a price per scope, not a cost plus our fee.
 *
 * So the markup is distributed across the scope lines in proportion to their
 * size, and the last line absorbs the rounding drift so the lines still add
 * up to the bid amount exactly, to the cent. Callers keep the cost-basis
 * lines for internal review; only what leaves the building comes through here.
 */
export function offerLineItems(
  items: Array<{ label: string; amount: number }>,
  bidAmount: number
): Array<{ label: string; amount: number }> {
  const subtotal = items.reduce((sum, i) => sum + i.amount, 0);
  if (items.length === 0 || !(subtotal > 0) || !(bidAmount > 0)) {
    return items.map((i) => ({ ...i }));
  }
  const out = items.map((i) => ({
    label: i.label,
    amount: Math.round((i.amount / subtotal) * bidAmount * 100) / 100,
  }));
  const drift =
    Math.round((bidAmount - out.reduce((sum, i) => sum + i.amount, 0)) * 100) / 100;
  if (drift !== 0) {
    const last = out[out.length - 1];
    last.amount = Math.round((last.amount + drift) * 100) / 100;
  }
  return out;
}
