/**
 * One priced row per trade scope.
 *
 * The old model was a `quotes` table: an amount, a payment-terms string, a
 * note. It answered "what did somebody say the number was" and nothing else,
 * so every question an estimator actually asks at bid time had to be answered
 * from memory:
 *
 *   Does that price include the tax, or is the tax mine?
 *   They excluded the crane. Who is carrying the crane?
 *   Is that number still good on Friday when this closes?
 *   Can they start inside the schedule, or did they say "probably"?
 *   Was that a firm quote or a figure off the top of somebody's head?
 *
 * A bid assembled from remembered answers renders identically to a bid
 * assembled from signed quotes. That is the defect: not that the information
 * was missing, but that its absence was invisible.
 *
 * Two rules hold everything below together.
 *
 * Unknown is not zero. Every money field is `number | null` and null never
 * becomes 0 in a sum. A total exists only when every component of it does.
 *
 * A hole is not a discount. When a subcontractor excludes work and nobody has
 * been assigned to pick it up, the trade's number is not "cheaper", it is
 * incomplete, and the row says so rather than quietly totalling.
 *
 * Pure. No database, no clock: "now" is always passed in, so a quote that
 * expires tomorrow reads the same way in a test as it does in October.
 */
import { round2 } from "./pricing";
import {
  tradeCost,
  bidMath,
  type CostComponent,
  type TradeCost,
  type BidMath,
  COMPONENT_LABEL,
} from "./trade-pricing";

export type { CostComponent };

/**
 * How much weight the number can carry.
 *
 * Ordered weakest-first on purpose: the aggregate confidence of a bid is the
 * weakest row in it, not the average, because the bid is wrong if any single
 * trade is wrong.
 */
export const CONFIDENCE = ["unknown", "rough", "budgetary", "firm"] as const;
export type Confidence = (typeof CONFIDENCE)[number];

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  unknown: "Confidence not recorded",
  rough: "Rough number, not a quote",
  budgetary: "Budgetary quote",
  firm: "Firm quote",
};

/** Fails closed. Anything unrecognised is `unknown`, never `firm`. */
export function parseConfidence(v: unknown): Confidence {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return (CONFIDENCE as readonly string[]).includes(s) ? (s as Confidence) : "unknown";
}

/** Where excluded work landed. `unassigned` is the state that blocks a bid. */
export const COVERED_BY = [
  "another_trade",
  "self_perform",
  "not_required",
  "unassigned",
] as const;
export type CoveredBy = (typeof COVERED_BY)[number];

export const COVERED_BY_LABEL: Record<CoveredBy, string> = {
  another_trade: "Covered by another trade",
  self_perform: "Brost Co is doing it",
  not_required: "Not required by this solicitation",
  unassigned: "Nobody assigned",
};

export function parseCoveredBy(v: unknown): CoveredBy {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return (COVERED_BY as readonly string[]).includes(s) ? (s as CoveredBy) : "unassigned";
}

export interface Alternate {
  label: string;
  /** Null is a priced-unknown alternate, which is not a free one. */
  amount: number | null;
  /** Whether this alternate is in the bid. */
  included: boolean;
}

export interface Exclusion {
  text: string;
  coveredBy: CoveredBy;
  note?: string | null;
}

export interface PricingRow {
  id?: string;
  /** Normalised trade name. The identity of the row. */
  scopeKey: string;
  /** The trade as the solicitation writes it. */
  trade: string;

  selectedSubId: string | null;
  selectedSubName?: string | null;
  backupSubId: string | null;
  backupSubName?: string | null;

  baseQuote: number | null;
  taxes: number | null;
  freight: number | null;
  mobilization: number | null;
  bonding: number | null;
  manualAdjustment: number | null;
  manualAdjustmentReason: string | null;
  pendingComponents: CostComponent[];

  alternates: Alternate[];
  exclusions: Exclusion[];

  paymentTerms: string | null;
  /** ISO date (yyyy-mm-dd) or null when nobody recorded one. */
  quoteExpiresOn: string | null;
  availability: string | null;
  leadTimeDays: number | null;
  confidence: Confidence;

  supportingDocumentId: string | null;
  updatedAt?: Date | null;
  updatedBy?: string | null;

  /**
   * True when this row was projected from the older quote screen rather than
   * entered here.
   *
   * There is one pricing model, not two. Rather than backfill the new table
   * with figures nobody reviewed, a trade whose only price is a `quotes` row
   * is projected into a row at read time and labelled. The projection carries
   * exactly what a quote knows and nothing else: an amount, the firm, the
   * terms. It never claims a confidence, an expiry, or an exclusion list,
   * because the quote screen never asked for any of them.
   */
  derived?: boolean;

  /**
   * Competing quotes on file for this trade.
   *
   * Several subcontractors quoting the same work is the normal case and is not
   * itself a problem. Picking one is a decision, and picking the lowest
   * automatically is the product making it: the cheapest quote is regularly
   * the one that excluded the most.
   */
  candidates?: QuoteCandidate[];
}

export interface QuoteCandidate {
  quoteId: string;
  subId: string | null;
  subName: string | null;
  amount: number;
  paymentTerms: string | null;
  outOfRange: boolean;
}

/**
 * The identity of a trade scope.
 *
 * The analysis emits trade names as free text and re-emits them on every
 * re-analysis, so the only stable handle is the name itself, normalised.
 * Case, spacing and separator punctuation vary between one run and the next
 * and between the analysis and what an operator types; the underlying work
 * does not.
 */
export function tradeScopeKey(trade: string): string {
  return trade
    .toLowerCase()
    .replace(/[\s_/\\-]+/g, " ")
    .replace(/[^a-z0-9 &]/g, "")
    .trim()
    .replace(/ +/g, "-");
}

export const PROBLEM_SEVERITY = ["blocker", "warning", "note"] as const;
export type ProblemSeverity = (typeof PROBLEM_SEVERITY)[number];

export interface RowProblem {
  code: string;
  severity: ProblemSeverity;
  /** What is wrong, in the words an estimator would use. */
  message: string;
  /** What to do about it. Omitted when the fix is obvious from the message. */
  fix?: string;
}

export interface RowContext {
  /** The moment being judged against. Always supplied. */
  now: Date;
  /** When the bid is due, when it is known. */
  bidDueAt?: Date | null;
  /**
   * Whether this solicitation requires quotes to be valid through a date.
   * Many do; an expired quote only hard-blocks when one does.
   */
  quoteValidityRequired?: boolean;
  /** Days between award and the work needing to start, when known. */
  daysUntilWorkStarts?: number | null;
}

export interface PricedRow {
  row: PricingRow;
  cost: TradeCost;
  /** Included alternates, summed. Null when any included alternate is unpriced. */
  alternatesTotal: number | null;
  /** Base components plus included alternates. Null when anything is unknown. */
  total: number | null;
  problems: RowProblem[];
  /** True when nothing here can stop the bid going out. */
  clear: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Parses a yyyy-mm-dd date as UTC midnight. Returns null on anything else. */
export function parseIsoDate(v: string | null | undefined): Date | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Everything that is wrong with one row, and what it costs.
 *
 * Severity is the whole point of this function. `blocker` means the bid cannot
 * truthfully go out: nobody knows the number, or work has been written out of
 * the price and left with nobody. `warning` means a person should look and may
 * legitimately decide to proceed, which is what the override flow exists for.
 * Mixing the two is how a missing price ends up behind the same "acknowledge"
 * button as a low-confidence one.
 */
export function priceRow(row: PricingRow, ctx: RowContext): PricedRow {
  const cost = tradeCost({
    baseQuote: row.baseQuote,
    taxes: row.taxes ?? undefined,
    freight: row.freight ?? undefined,
    mobilization: row.mobilization ?? undefined,
    bonding: row.bonding ?? undefined,
    manualAdjustment: row.manualAdjustment ?? undefined,
    manualAdjustmentReason: row.manualAdjustmentReason,
    pending: row.pendingComponents,
  });

  const included = row.alternates.filter((a) => a.included);
  const alternatesUnpriced = included.filter((a) => a.amount == null);
  const alternatesTotal =
    alternatesUnpriced.length > 0
      ? null
      : round2(included.reduce((sum, a) => sum + (a.amount ?? 0), 0));

  const total =
    cost.total != null && alternatesTotal != null ? round2(cost.total + alternatesTotal) : null;

  const problems: RowProblem[] = [];

  for (const component of cost.unknown) {
    problems.push({
      code: `unknown:${component}`,
      severity: "blocker",
      message: `The ${COMPONENT_LABEL[component]} for ${row.trade} is not known.`,
      fix: "Enter the figure, or mark the component as not applying to this trade.",
    });
  }

  for (const alt of alternatesUnpriced) {
    problems.push({
      code: "alternate_unpriced",
      severity: "blocker",
      message: `Alternate "${alt.label}" is in the bid for ${row.trade} with no price.`,
      fix: "Price it or take it out of the bid.",
    });
  }

  const unassigned = row.exclusions.filter((e) => e.coveredBy === "unassigned");
  for (const ex of unassigned) {
    problems.push({
      code: "exclusion_unassigned",
      severity: "blocker",
      message: `${row.trade} excluded "${ex.text}" and nobody is carrying it.`,
      fix: "Assign it to another trade, to Brost Co, or record that this solicitation does not require it.",
    });
  }

  if (cost.adjustmentUnexplained) {
    problems.push({
      code: "adjustment_unexplained",
      severity: "blocker",
      message: `${row.trade} has a manual adjustment with no reason recorded.`,
      fix: "Say why the number moved. It is the only record of it six weeks from now.",
    });
  }

  const candidates = row.candidates ?? [];
  if (candidates.length > 1 && row.baseQuote == null) {
    problems.push({
      code: "competing_quotes_unselected",
      severity: "blocker",
      message: `${candidates.length} subcontractors have quoted ${row.trade} and none has been chosen.`,
      fix: "Pick the quote this bid is built on. The lowest is not automatically the right one; check what each excluded.",
    });
  }

  if (row.selectedSubId == null) {
    problems.push({
      code: "no_selected_sub",
      severity: row.baseQuote == null ? "warning" : "blocker",
      message:
        row.baseQuote == null
          ? `No subcontractor is selected for ${row.trade}.`
          : `${row.trade} is priced but no subcontractor is selected to do the work.`,
      fix: "Pick the firm this price came from.",
    });
  }

  const expires = parseIsoDate(row.quoteExpiresOn);
  if (expires == null) {
    if (row.baseQuote != null) {
      problems.push({
        code: "no_expiry",
        severity: "warning",
        message: `Nobody recorded how long the ${row.trade} price is good for.`,
        fix: "Ask the subcontractor, or record that they did not say.",
      });
    }
  } else if (expires.getTime() < ctx.now.getTime()) {
    problems.push({
      code: "quote_expired",
      // Expiry only hard-blocks where the solicitation requires quotes to hold.
      // Elsewhere it is a real risk and a judgement call, which is what the
      // override flow is for.
      severity: ctx.quoteValidityRequired ? "blocker" : "warning",
      message: `The ${row.trade} quote expired on ${row.quoteExpiresOn}.`,
      fix: "Get it re-confirmed before this goes out.",
    });
  } else if (ctx.bidDueAt && expires.getTime() < ctx.bidDueAt.getTime()) {
    problems.push({
      code: "quote_expires_before_due",
      severity: "warning",
      message: `The ${row.trade} quote expires on ${row.quoteExpiresOn}, before this bid is due.`,
      fix: "Ask for validity through the award date.",
    });
  }

  if (row.confidence === "unknown" && row.baseQuote != null) {
    problems.push({
      code: "confidence_unknown",
      severity: "warning",
      message: `Nobody recorded whether the ${row.trade} number is a firm quote or an estimate.`,
    });
  } else if (row.confidence === "rough" && row.baseQuote != null) {
    problems.push({
      code: "confidence_rough",
      severity: "warning",
      message: `The ${row.trade} number is a rough figure, not a quote.`,
      fix: "Get it in writing before the bid goes out.",
    });
  }

  if (
    row.leadTimeDays != null &&
    ctx.daysUntilWorkStarts != null &&
    row.leadTimeDays > ctx.daysUntilWorkStarts
  ) {
    problems.push({
      code: "lead_time_exceeds_schedule",
      severity: "warning",
      message: `${row.trade} needs ${row.leadTimeDays} days' lead time and the work starts in ${ctx.daysUntilWorkStarts}.`,
      fix: "Confirm the schedule with them, or price the backup.",
    });
  }

  if (row.backupSubId == null && row.selectedSubId != null) {
    problems.push({
      code: "no_backup",
      severity: "note",
      message: `No backup subcontractor for ${row.trade}.`,
    });
  }

  return {
    row,
    cost,
    alternatesTotal,
    total,
    problems,
    clear: problems.every((p) => p.severity === "note"),
  };
}

export interface PricingSheet {
  rows: PricedRow[];
  /** Required trades with no row at all. */
  missingTrades: string[];
  /**
   * Rows priced for a trade this solicitation no longer lists.
   *
   * Re-analysis rewrites the trade list. A row left behind is not deleted,
   * because deleting it throws away a price somebody obtained; it is shown,
   * excluded from the total, and named.
   */
  orphanedRows: PricedRow[];
  /** Sum across the rows that belong. Null when any of them is unknown. */
  cost: number | null;
  /** Which trades made the cost unknown, in the order they appear. */
  unknownTrades: string[];
  problems: RowProblem[];
  blockers: RowProblem[];
  /** Weakest confidence across priced rows, or null when nothing is priced. */
  weakestConfidence: Confidence | null;
}

/**
 * The whole sheet, reconciled against what the solicitation actually asks for.
 *
 * The reconciliation is the part that matters. A pricing table that shows only
 * the rows somebody has created will always look complete, because a trade
 * nobody remembered to price simply is not on it.
 */
export function pricingSheet(
  requiredTrades: string[],
  rows: PricingRow[],
  ctx: RowContext
): PricingSheet {
  const required = requiredTrades.map((t) => t.trim()).filter(Boolean);
  const requiredKeys = new Map(required.map((t) => [tradeScopeKey(t), t]));

  const byKey = new Map<string, PricingRow>();
  for (const row of rows) byKey.set(row.scopeKey, row);

  const belongs: PricedRow[] = [];
  const missingTrades: string[] = [];
  for (const [key, trade] of requiredKeys) {
    const row = byKey.get(key);
    if (!row) {
      missingTrades.push(trade);
      continue;
    }
    belongs.push(priceRow(row, ctx));
  }

  const orphanedRows = rows
    .filter((r) => !requiredKeys.has(r.scopeKey))
    .map((r) => priceRow(r, ctx));

  const unknownTrades = belongs.filter((p) => p.total == null).map((p) => p.row.trade);
  const cost =
    missingTrades.length > 0 || unknownTrades.length > 0
      ? null
      : round2(belongs.reduce((sum, p) => sum + (p.total ?? 0), 0));

  const problems: RowProblem[] = belongs.flatMap((p) => p.problems);
  for (const trade of missingTrades) {
    problems.unshift({
      code: "trade_unpriced",
      severity: "blocker",
      message: `${trade} has no pricing row at all.`,
      fix: "Add the trade and enter what it costs, even if the number is provisional.",
    });
  }
  for (const orphan of orphanedRows) {
    problems.push({
      code: "trade_not_in_scope",
      severity: "warning",
      message: `${orphan.row.trade} is priced but this solicitation no longer lists it.`,
      fix: "Remove the row, or re-check the trade list against the current amendment.",
    });
  }

  const priced = belongs.filter((p) => p.row.baseQuote != null);
  const weakestConfidence =
    priced.length === 0
      ? null
      : priced
          .map((p) => p.row.confidence)
          .reduce((weakest, c) =>
            CONFIDENCE.indexOf(c) < CONFIDENCE.indexOf(weakest) ? c : weakest
          );

  return {
    rows: belongs,
    missingTrades,
    orphanedRows,
    cost,
    unknownTrades,
    problems,
    blockers: problems.filter((p) => p.severity === "blocker"),
    weakestConfidence,
  };
}

export interface Scenario {
  /** What the operator called it. */
  label: string;
  math: BidMath;
  /** Why this one cannot be compared, when it cannot. */
  unknown: string | null;
}

export interface ScenarioInput {
  label: string;
  /** Bid amount, when the scenario names one directly. */
  bid?: number | null;
  /** Target margin, when the scenario is expressed as one instead. */
  targetMarginPct?: number | null;
  contingencyPct?: number | null;
}

/**
 * Side-by-side scenarios off one cost.
 *
 * The instruction is scenario comparison, and the trap is that a comparison
 * table is the easiest place in a product to print a confident zero. If the
 * cost is unknown then every scenario built on it is unknown, and the honest
 * table has a row of "not yet known" in it rather than a column of tidy
 * numbers computed from a cost of nothing.
 */
export function compareScenarios(
  cost: number | null,
  scenarios: ScenarioInput[]
): Scenario[] {
  return scenarios.map((s) => {
    let bid = s.bid ?? null;
    if (bid == null && s.targetMarginPct != null && cost != null) {
      const m = s.targetMarginPct / 100;
      // A 100% margin is a bid of infinity, which is not a scenario.
      bid = m >= 1 ? null : round2(loadedFor(cost, s.contingencyPct) / (1 - m));
    }
    const math = bidMath({ cost, bid, contingencyPct: s.contingencyPct ?? null });
    let unknown: string | null = null;
    if (cost == null) unknown = "Cost is not known, so this scenario cannot be worked out.";
    else if (bid == null) {
      unknown =
        s.targetMarginPct != null && s.targetMarginPct >= 100
          ? "A margin of 100% or more has no bid amount."
          : "This scenario has no bid amount set.";
    }
    return { label: s.label, math, unknown };
  });
}

function loadedFor(cost: number, contingencyPct: number | null | undefined): number {
  const pct = typeof contingencyPct === "number" && Number.isFinite(contingencyPct) ? contingencyPct : 0;
  return round2(cost + cost * (pct / 100));
}

/**
 * The line that goes under the totals.
 *
 * Returned as a sentence rather than a number so a caller cannot render the
 * absence of a cost as a currency-formatted zero.
 */
export function sheetSummary(sheet: PricingSheet): string {
  if (sheet.rows.length === 0 && sheet.missingTrades.length === 0) {
    return "No trades have been identified for this solicitation yet.";
  }
  if (sheet.missingTrades.length > 0) {
    const list = sheet.missingTrades.join(", ");
    return `Not costed: ${sheet.missingTrades.length} trade${
      sheet.missingTrades.length === 1 ? "" : "s"
    } with no pricing row (${list}).`;
  }
  if (sheet.unknownTrades.length > 0) {
    return `Cost is not known: ${sheet.unknownTrades.join(", ")} ${
      sheet.unknownTrades.length === 1 ? "has" : "have"
    } components nobody has established.`;
  }
  return `Cost is the sum of ${sheet.rows.length} priced trade${
    sheet.rows.length === 1 ? "" : "s"
  }.`;
}

/** An empty row for a trade, so the table can show what still needs a price. */
export function emptyRow(trade: string): PricingRow {
  return {
    scopeKey: tradeScopeKey(trade),
    trade,
    selectedSubId: null,
    backupSubId: null,
    baseQuote: null,
    taxes: null,
    freight: null,
    mobilization: null,
    bonding: null,
    manualAdjustment: null,
    manualAdjustmentReason: null,
    pendingComponents: [],
    alternates: [],
    exclusions: [],
    paymentTerms: null,
    quoteExpiresOn: null,
    availability: null,
    leadTimeDays: null,
    confidence: "unknown",
    supportingDocumentId: null,
  };
}
