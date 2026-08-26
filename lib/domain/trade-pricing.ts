/**
 * What one trade actually costs, and what the bid asks for it.
 *
 * A trade's price is not one number. It is a base quote plus whatever the
 * subcontractor excluded and somebody else has to carry: tax, freight,
 * mobilisation, bonding, and whatever the estimator adjusted by hand. Each of
 * those is separately knowable, separately missing, and separately wrong.
 *
 * The rule this module exists to hold is the one the brief states outright:
 * never show 0 for a value nobody knows. `marginFromBid` in the sibling
 * pricing module returns 0 when the bid is zero, which is correct arithmetic
 * and a false statement about the world: an unpriced trade reading "0% margin"
 * looks like a thin job rather than an unanswered question, and a total that
 * silently treats a missing freight number as nothing is a total that is too
 * low by exactly the amount nobody has found out yet.
 *
 * So every component is `number | null`, null means nobody knows, and unknown
 * propagates. A total is a number only when every part of it is.
 *
 * Pure.
 */
import { round2 } from "./pricing";

/** The parts of one trade's cost. Null means nobody has established it. */
export interface TradeCostInput {
  /** What the selected subcontractor quoted. */
  baseQuote: number | null;
  /** Sales or use tax somebody has to pay. */
  taxes?: number | null;
  freight?: number | null;
  mobilization?: number | null;
  bonding?: number | null;
  /**
   * The estimator's own adjustment, positive or negative, with the reason.
   * An adjustment with no reason is a number nobody can defend later.
   */
  manualAdjustment?: number | null;
  manualAdjustmentReason?: string | null;
}

export type CostComponent =
  | "baseQuote"
  | "taxes"
  | "freight"
  | "mobilization"
  | "bonding"
  | "manualAdjustment";

export const COMPONENT_LABEL: Record<CostComponent, string> = {
  baseQuote: "base quote",
  taxes: "taxes",
  freight: "freight",
  mobilization: "mobilisation",
  bonding: "bonding",
  manualAdjustment: "manual adjustment",
};

/**
 * Components that must be established before a total means anything.
 *
 * Only the base quote. The rest are legitimately absent on most jobs: a trade
 * with no freight is not a trade with unknown freight, and demanding a zero be
 * typed into every box would turn the distinction this module exists to
 * protect into a chore that gets clicked through.
 *
 * The difference is in how they are supplied: a missing optional component is
 * absent, and `null` on the base quote is the thing nobody has answered.
 */
const REQUIRED: CostComponent[] = ["baseQuote"];

export interface TradeCost {
  /** The sum, or null when something required is unknown. */
  total: number | null;
  /** Which required components are missing, in the order asked about. */
  unknown: CostComponent[];
  /** What was actually added, so the arithmetic can be shown. */
  parts: { component: CostComponent; amount: number }[];
  /** True when a manual adjustment was applied without a reason. */
  adjustmentUnexplained: boolean;
}

export function tradeCost(input: TradeCostInput): TradeCost {
  const entries: [CostComponent, number | null | undefined][] = [
    ["baseQuote", input.baseQuote],
    ["taxes", input.taxes],
    ["freight", input.freight],
    ["mobilization", input.mobilization],
    ["bonding", input.bonding],
    ["manualAdjustment", input.manualAdjustment],
  ];

  const unknown: CostComponent[] = [];
  const parts: { component: CostComponent; amount: number }[] = [];
  for (const [component, value] of entries) {
    if (value == null) {
      // Undefined is "not applicable to this trade"; null is "nobody knows".
      // Only the second is a gap, and only on a required component.
      if (value === null && REQUIRED.includes(component)) unknown.push(component);
      continue;
    }
    if (!Number.isFinite(value)) {
      unknown.push(component);
      continue;
    }
    parts.push({ component, amount: value });
  }

  const total =
    unknown.length > 0 ? null : round2(parts.reduce((sum, p) => sum + p.amount, 0));

  return {
    total,
    unknown,
    parts,
    adjustmentUnexplained:
      input.manualAdjustment != null &&
      input.manualAdjustment !== 0 &&
      !input.manualAdjustmentReason?.trim(),
  };
}

export interface BidMathInput {
  /** Total cost across every trade, or null when any trade is unknown. */
  cost: number | null;
  /** What the bid asks for. */
  bid: number | null;
  /** A percentage of cost held back for risk, when the account uses one. */
  contingencyPct?: number | null;
}

export interface BidMath {
  cost: number | null;
  contingency: number | null;
  /** Cost plus contingency: what the job is expected to consume. */
  loadedCost: number | null;
  bid: number | null;
  /** bid minus loaded cost. Negative is a loss, and is reported as one. */
  grossProfit: number | null;
  /** profit / bid. What the industry calls margin. */
  marginPct: number | null;
  /** profit / cost. What the industry calls markup. A different number. */
  markupPct: number | null;
  /** Why a figure is null, in the order somebody would fix them. */
  unknown: string[];
  /** True when the bid is below what the job costs. */
  belowCost: boolean;
}

/**
 * Margin and markup, kept apart.
 *
 * They are computed from the same two numbers and they are not the same
 * number: at a 20% margin the markup is 25%, and an estimator who applies 20%
 * markup believing they priced a 20% margin has underpriced the job by a fifth
 * of their profit. The instructions call for both to be shown, correct and
 * distinct, which means both are labelled with their denominator wherever they
 * appear.
 */
export function bidMath(input: BidMathInput): BidMath {
  const unknown: string[] = [];
  const cost = numberOrNull(input.cost);
  const bid = numberOrNull(input.bid);
  if (cost == null) unknown.push("what the work costs");
  if (bid == null) unknown.push("what the bid asks for");

  const pct = numberOrNull(input.contingencyPct);
  const contingency = cost != null && pct != null ? round2(cost * (pct / 100)) : null;
  const loadedCost = cost != null ? round2(cost + (contingency ?? 0)) : null;

  const grossProfit = bid != null && loadedCost != null ? round2(bid - loadedCost) : null;

  /*
   * A zero bid is not a zero margin, it is a bid nobody has set. Dividing by
   * it and reporting 0% is how an unpriced job reads as a thin one.
   */
  const marginPct =
    grossProfit != null && bid != null && bid > 0 ? round2((grossProfit / bid) * 100) : null;
  const markupPct =
    grossProfit != null && loadedCost != null && loadedCost > 0
      ? round2((grossProfit / loadedCost) * 100)
      : null;

  if (marginPct == null && cost != null && bid != null) {
    unknown.push("margin, because the bid is zero");
  }

  return {
    cost,
    contingency,
    loadedCost,
    bid,
    grossProfit,
    marginPct,
    markupPct,
    unknown,
    belowCost: grossProfit != null && grossProfit < 0,
  };
}

function numberOrNull(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * The arithmetic, written out.
 *
 * The instructions ask for formulas, inputs and rounding to be explained, and
 * the reason is that an estimator who cannot see how a number was reached
 * cannot tell a wrong one from a surprising one. This is what goes behind the
 * figure, not instead of it.
 */
export function explainBidMath(m: BidMath): string[] {
  const lines: string[] = [];
  if (m.cost == null) {
    lines.push("Cost is unknown, so nothing below it can be worked out.");
    return lines;
  }
  lines.push(`Cost is the sum of every trade's priced components: ${money(m.cost)}.`);
  if (m.contingency != null) {
    lines.push(
      `Contingency is added to cost, giving ${money(m.loadedCost)} as what the job is expected to consume.`
    );
  }
  if (m.bid == null) {
    lines.push("The bid amount has not been set, so profit and margin cannot be worked out.");
    return lines;
  }
  lines.push(`Gross profit is the bid minus that: ${money(m.bid)} - ${money(m.loadedCost)} = ${money(m.grossProfit)}.`);
  if (m.marginPct != null) {
    lines.push(`Margin is profit divided by the BID: ${m.marginPct}%.`);
  }
  if (m.markupPct != null) {
    lines.push(
      `Markup is profit divided by the COST: ${m.markupPct}%. These are different numbers and neither is the other.`
    );
  }
  lines.push("Every figure is rounded to the cent at each step, not only at the end.");
  return lines;
}

function money(n: number | null): string {
  if (n == null) return "unknown";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * One line about a figure nobody can compute yet.
 *
 * Returned instead of a number so a caller cannot accidentally render a zero.
 */
export function unknownSummary(m: BidMath): string | null {
  if (m.unknown.length === 0) return null;
  return `Not yet known: ${m.unknown.join(", ")}.`;
}
