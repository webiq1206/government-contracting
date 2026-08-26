/**
 * A subcontractor's reply, turned into the row that prices their trade.
 *
 * The extractor already read the email carefully: the price, whether they
 * called it firm, what they excluded, how soon they can start, how long the
 * number holds. All of that then went into a `notes` string on a `quotes` row
 * and stopped existing as data. The estimator got an amount and a paragraph,
 * and every question the paragraph answered had to be asked again later.
 *
 * This maps the reading onto the pricing row, and refuses where the reading is
 * not good enough to act on. The refusals are the important half:
 *
 * A quote with no exact trade, on a subcontractor paired to several, is not
 * saved. It cannot be: filing a plumbing price under electrical is worse than
 * having no price, because the second is visible and the first is not.
 *
 * A quote whose scope does not cover what was asked is not treated as covering
 * it. A firm who prices two of three buildings, in an email that reads like a
 * complete quote, is a partial answer and the uncovered part stays open.
 *
 * And nothing here upgrades confidence. A reply that does not say whether the
 * number is firm produces `unknown`, never `firm`, because the whole reason
 * the field exists is to distinguish a signed quote from a figure somebody
 * read off the top of their head.
 *
 * Pure. The reply's own timestamp is passed in, so a validity of "30 days"
 * resolves against when it was actually written.
 */
import { tradeScopeKey, type Alternate, type Confidence, type CostComponent, type Exclusion } from "./pricing-row";

/** The subset of an extracted reply this module reads. */
export interface QuoteReading {
  isQuote: boolean;
  quoteAmount: number | null;
  paymentTerms: string | null;
  exclusions: string[];
  alternates: string[];
  qualifications: string[];
  leadTimeDays: number | null;
  availabilityNotes: string | null;
  earliestStart: string | null;
  quoteValidUntil: string | null;
  priceIsFirm: boolean | null;
  taxesIncluded: boolean | null;
  taxesAmount: number | null;
  freightAmount: number | null;
  mobilizationAmount: number | null;
  bondingAmount: number | null;
  coversFullScope: boolean | null;
  uncoveredScope: string | null;
  conflicts: string[];
  confidence: number;
}

export interface QuoteContext {
  /** The trade this reply is about, when exactly one is established. */
  trade: string | null;
  /** Every trade this subcontractor is paired to on this opportunity. */
  pairedTrades: string[];
  /** When the reply arrived, for resolving a relative validity period. */
  receivedAt: Date;
  /** True when a person has already priced this trade by hand. */
  operatorRowExists?: boolean;
}

export const REFUSALS = [
  "not_a_quote",
  "no_amount",
  "ambiguous_trade",
  "partial_scope",
  "contradictory",
  "operator_row_exists",
] as const;
export type Refusal = (typeof REFUSALS)[number];

export const REFUSAL_MESSAGE: Record<Refusal, string> = {
  not_a_quote: "The reply does not contain a price for the work.",
  no_amount: "The reply reads as a quote but no usable amount could be read from it.",
  ambiguous_trade:
    "This subcontractor is on more than one trade here and the reply does not say which one it prices.",
  partial_scope: "The reply covers only part of the work that was asked for.",
  contradictory: "The reply contradicts itself, so no single number can be taken from it.",
  operator_row_exists: "Somebody has already priced this trade by hand.",
};

/** The row fields a reply can supply, and what it could not answer. */
export interface ProposedRow {
  trade: string;
  scopeKey: string;
  baseQuote: number;
  taxes: number | null;
  freight: number | null;
  mobilization: number | null;
  bonding: number | null;
  pendingComponents: CostComponent[];
  paymentTerms: string | null;
  quoteExpiresOn: string | null;
  availability: string | null;
  leadTimeDays: number | null;
  confidence: Confidence;
  exclusions: Exclusion[];
  alternates: Alternate[];
  /**
   * Things the reply never answered, in the words the clarification email
   * uses. Empty is not the same as complete: it means nothing on this list
   * was missing.
   */
  missing: string[];
  /** What the reply said that could not be turned into a field. */
  notes: string[];
}

export type QuoteProposal =
  | { ok: true; row: ProposedRow }
  | { ok: false; refusal: Refusal; message: string; uncoveredScope?: string | null };

/**
 * Read one reply into a pricing row, or say why not.
 */
export function proposeRow(reading: QuoteReading, ctx: QuoteContext): QuoteProposal {
  if (!reading.isQuote) return refuse("not_a_quote");
  const amount = reading.quoteAmount;
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return refuse("no_amount");

  /*
   * The multi-trade rule.
   *
   * A single-trade pairing needs no naming: there is only one thing they could
   * be pricing. Several trades and no name is the case that must not be
   * guessed, and it is not rare: a firm that does electrical and low voltage
   * gets asked about both in one email and answers with one number.
   */
  const trade = ctx.trade?.trim() || null;
  if (!trade) {
    if (ctx.pairedTrades.length === 1) {
      return proposeFor(ctx.pairedTrades[0]!, reading, ctx);
    }
    return refuse("ambiguous_trade");
  }

  return proposeFor(trade, reading, ctx);
}

function refuse(refusal: Refusal): QuoteProposal {
  return { ok: false, refusal, message: REFUSAL_MESSAGE[refusal] };
}

/**
 * Everything that is checked once the trade is settled.
 *
 * Deliberately the only place these three run. Writing them in the caller as
 * well, so that the single-trade shortcut above got its own copy, is how one
 * rule becomes two that drift.
 */
function proposeFor(trade: string, reading: QuoteReading, ctx: QuoteContext): QuoteProposal {
  /*
   * The list fields are read defensively.
   *
   * The type says they are arrays and the production extractor always fills
   * them, but this function sits on the path that decides whether a real price
   * gets filed at all, and it is reached from a caller that accepts an
   * injectable extractor. A throw here would lose the reply rather than refuse
   * it, which is the one outcome worse than either.
   */
  const conflicts = reading.conflicts ?? [];
  const exclusions = reading.exclusions ?? [];
  const alternates = reading.alternates ?? [];
  const qualifications = reading.qualifications ?? [];

  if (conflicts.length > 0) return refuse("contradictory");
  if (reading.coversFullScope === false) {
    return {
      ok: false,
      refusal: "partial_scope",
      message: REFUSAL_MESSAGE.partial_scope,
      uncoveredScope: reading.uncoveredScope,
    };
  }
  if (ctx.operatorRowExists) return refuse("operator_row_exists");

  const pending: CostComponent[] = [];
  const missing: string[] = [];

  /*
   * "Tax not included" is the case the pending mechanism exists for.
   *
   * The subcontractor has told us there is tax and has not told us how much.
   * Leaving the column null would let the total add up as though there were
   * none, which is the exact arithmetic this project keeps refusing to do.
   */
  if (reading.taxesIncluded === false && reading.taxesAmount == null) {
    pending.push("taxes");
    missing.push("taxes");
  }
  if (reading.taxesIncluded == null && reading.taxesAmount == null) {
    // They did not say either way. Not an assumption either direction, and
    // worth asking, but not something to block a total over.
    missing.push("taxes");
  }
  if (reading.leadTimeDays == null && !reading.availabilityNotes && !reading.earliestStart) {
    missing.push("lead_time");
  }
  if (!reading.paymentTerms) missing.push("payment_terms");
  if (!reading.quoteValidUntil) missing.push("quote_validity");
  if (reading.priceIsFirm == null) missing.push("price_firmness");

  const notes: string[] = [];
  // Qualifications are conditions attached to the price, not exclusions, and
  // folding them together would make an assumption look like a coverage hole.
  for (const q of qualifications) if (q.trim()) notes.push(q.trim());
  if (reading.earliestStart?.trim()) notes.push(`Earliest start: ${reading.earliestStart.trim()}`);

  return {
    ok: true,
    row: {
      trade,
      scopeKey: tradeScopeKey(trade),
      baseQuote: reading.quoteAmount!,
      taxes: reading.taxesAmount,
      freight: reading.freightAmount,
      mobilization: reading.mobilizationAmount,
      bonding: reading.bondingAmount,
      pendingComponents: pending,
      paymentTerms: reading.paymentTerms?.trim() || null,
      quoteExpiresOn: resolveValidity(reading.quoteValidUntil, ctx.receivedAt),
      availability: availabilityOf(reading),
      leadTimeDays: reading.leadTimeDays,
      confidence: confidenceOf(reading),
      exclusions: exclusions
        .map((e) => e.trim())
        .filter(Boolean)
        .map<Exclusion>((text) => ({
          text,
          /*
           * Unassigned, always. A subcontractor saying they will not do
           * something is not a statement about who will, and defaulting to
           * anything else would close a coverage hole nobody has looked at.
           */
          coveredBy: "unassigned",
          note: "From their reply.",
        })),
      alternates: alternates
        .map((a) => a.trim())
        .filter(Boolean)
        .map<Alternate>((label) => ({
          label,
          // The extractor returns the offer as prose, not a figure, and an
          // alternate nobody has priced is not a free one.
          amount: null,
          // Offering an alternate is not us choosing it.
          included: false,
        })),
      missing,
      notes,
    },
  };
}

/**
 * How firm the number is, from what they actually said.
 *
 * Never upgrades. Silence is `unknown`, which reads on screen as "nobody
 * recorded whether this is a firm quote or an estimate", because that is what
 * happened.
 */
export function confidenceOf(reading: QuoteReading): Confidence {
  if (reading.priceIsFirm === true) return "firm";
  if (reading.priceIsFirm === false) return "budgetary";
  return "unknown";
}

function availabilityOf(reading: QuoteReading): string | null {
  const bits = [reading.availabilityNotes?.trim(), reading.earliestStart?.trim()].filter(Boolean);
  return bits.length > 0 ? bits.join(". ") : null;
}

const UNIT_DAYS: Record<string, number> = {
  day: 1,
  business: 1,
  week: 7,
  month: 30,
};

/**
 * A quote-validity phrase turned into a date, or null.
 *
 * "30 days" written on the fourth is arithmetic. "Until the end of the month",
 * "subject to review" and "until material prices move" are not, and inventing
 * a date for them would put an expiry on the screen that the subcontractor
 * never gave. Null makes the row say nobody recorded one, which is true.
 *
 * A month is treated as 30 days rather than a calendar month deliberately: the
 * shorter reading is the safe one, since the cost of being a day early is a
 * phone call and the cost of being a day late is a bid built on a dead price.
 */
export function resolveValidity(phrase: string | null, receivedAt: Date): string | null {
  if (!phrase) return null;
  const text = phrase.trim().toLowerCase();
  if (!text) return null;

  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const slash = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/.exec(text);
  if (slash) {
    const year = slash[3]!.length === 2 ? 2000 + Number(slash[3]) : Number(slash[3]);
    return isoOf(new Date(Date.UTC(year, Number(slash[1]) - 1, Number(slash[2]))));
  }

  const named =
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/.exec(
      text
    );
  if (named) {
    const month = MONTHS.indexOf(named[1]!);
    return isoOf(new Date(Date.UTC(Number(named[3]), month, Number(named[2]))));
  }

  const relative = /\b(\d{1,3})\s*(business\s+)?(day|week|month)s?\b/.exec(text);
  if (relative) {
    const n = Number(relative[1]);
    const unit = relative[3]!;
    if (!Number.isFinite(n) || n <= 0 || n > 365) return null;
    const days = relative[2] ? businessDays(n) : n * (UNIT_DAYS[unit] ?? 0);
    if (days <= 0) return null;
    return isoOf(new Date(receivedAt.getTime() + days * 86_400_000));
  }

  return null;
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** Five business days is a week plus the weekend it spans. */
function businessDays(n: number): number {
  return Math.floor(n / 5) * 7 + (n % 5);
}

function isoOf(d: Date): string | null {
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
