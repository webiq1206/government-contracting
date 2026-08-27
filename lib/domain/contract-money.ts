/**
 * What a contract is worth, what it was expected to make, and what is left.
 *
 * The record showed one number: the award amount. Expected profit and margin
 * had no columns and no renders, which meant the page could say what a job was
 * worth and never what it was worth doing.
 *
 * Nothing here is stored. Profit is the award less what the subcontractors
 * were quoted, and both of those are facts recorded elsewhere; a stored profit
 * would be a third number to keep in step with the two it comes from, and the
 * one that would silently go stale after the first modification.
 *
 * Every function returns null rather than zero when it cannot answer. A
 * contract whose subcontractor quotes nobody entered does not have a profit of
 * the full award, and a margin of 100% on a job that has not been priced is
 * the most dangerous number this page could print.
 *
 * Pure.
 */

export interface ContractMoneyFacts {
  /** The award, in cents. Null when nobody has recorded it. */
  awardCents?: number | null;
  /** What the subcontractors were quoted at bid time, in cents. */
  subQuoteCents?: number | null;
  /** Signed modifications to value, in cents. Deductive changes are negative. */
  modificationCents?: number | null;
  /** Invoiced to date, in cents. */
  invoicedCents?: number | null;
  /** Paid to date, in cents. */
  paidCents?: number | null;
  /** Retainage the agency holds, as a percentage. */
  retainagePct?: number | null;
}

export interface ContractMoney {
  /** Award plus signed modifications. Null when the award is unknown. */
  currentValueCents: number | null;
  /** Current value less the subcontractor quotes. Null when either is unknown. */
  expectedProfitCents: number | null;
  /** Expected profit over current value, as a percentage. */
  expectedMarginPct: number | null;
  /** Invoiced to date, carried through so the page shows the same figure. */
  invoicedCents: number | null;
  /** Paid to date. */
  paidCents: number | null;
  /** Current value less what has been invoiced. */
  remainingToInvoiceCents: number | null;
  /** Invoiced less paid. */
  outstandingCents: number | null;
  /** What the agency is holding back, when a rate is recorded. */
  retainageCents: number | null;
  /**
   * The facts this arithmetic needed and did not have.
   *
   * Returned rather than swallowed so the page can say which number to go and
   * find, instead of showing a dash somebody has to guess the reason for.
   */
  missing: MissingFact[];
}

export type MissingFact = "award" | "sub_quotes" | "invoices" | "payments";

export const MISSING_LABEL: Record<MissingFact, string> = {
  award: "the award amount",
  sub_quotes: "what the subcontractors quoted",
  invoices: "what has been invoiced",
  payments: "what has been paid",
};

function n(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function contractMoney(f: ContractMoneyFacts): ContractMoney {
  const award = n(f.awardCents);
  const subs = n(f.subQuoteCents);
  const mods = n(f.modificationCents) ?? 0;
  const invoiced = n(f.invoicedCents);
  const paid = n(f.paidCents);
  const retainagePct = n(f.retainagePct);

  const missing: MissingFact[] = [];
  if (award === null) missing.push("award");
  if (subs === null) missing.push("sub_quotes");
  if (invoiced === null) missing.push("invoices");
  if (paid === null) missing.push("payments");

  const currentValue = award === null ? null : award + mods;
  const expectedProfit =
    currentValue === null || subs === null ? null : currentValue - subs;
  /*
   * Guarded against a zero denominator rather than allowed to produce
   * Infinity. A contract recorded with a value of zero is a data-entry
   * mistake, and printing an infinite margin next to it helps nobody.
   */
  const expectedMargin =
    expectedProfit === null || currentValue === null || currentValue === 0
      ? null
      : (expectedProfit / currentValue) * 100;

  return {
    currentValueCents: currentValue,
    invoicedCents: invoiced,
    paidCents: paid,
    expectedProfitCents: expectedProfit,
    expectedMarginPct: expectedMargin,
    remainingToInvoiceCents:
      currentValue === null || invoiced === null ? null : currentValue - invoiced,
    outstandingCents: invoiced === null || paid === null ? null : invoiced - paid,
    retainageCents:
      currentValue === null || retainagePct === null
        ? null
        : Math.round((currentValue * retainagePct) / 100),
    missing,
  };
}

/**
 * Whether an expected margin is worth flagging.
 *
 * Returns null for an unknown margin rather than treating it as fine. A job
 * whose subcontractor costs nobody has entered is not a healthy job; it is an
 * unmeasured one, and the two must not read the same.
 */
export function marginConcern(
  pct: number | null,
  targetPct: number | null | undefined
): "unknown" | "below_target" | "negative" | "fine" {
  if (pct === null) return "unknown";
  if (pct < 0) return "negative";
  const target = n(targetPct);
  if (target !== null && pct < target) return "below_target";
  return "fine";
}

export const MARGIN_CONCERN_TEXT: Record<
  ReturnType<typeof marginConcern>,
  string | null
> = {
  unknown: "Not enough recorded to work out a margin.",
  negative: "This contract is priced to lose money.",
  below_target: "Below the margin this was meant to earn.",
  fine: null,
};
