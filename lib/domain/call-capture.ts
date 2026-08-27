/**
 * Turning what a subcontractor said on the phone into pricing facts.
 *
 * The call workspace now asks about tax, freight, mobilization, payment terms,
 * how long the price is good for and how long the material takes. Those are
 * the six answers that change what a number means, and every one of them has
 * cost somebody a margin. Asking them and leaving them in a call record nobody
 * reads would be worse than not asking: it would look like the platform had
 * the information.
 *
 * The pricing workspace already holds all six on `trade_pricing_rows`. This is
 * the translation, and it is deliberately careful in one direction: the call
 * learns *whether* tax is included, not how much it is. So a "no" becomes an
 * exclusion in words rather than a zero in a numeric column, because a zero
 * there would read as "tax is nil" rather than "they did not include it".
 *
 * Pure. Every answer that was not given comes back null, and null means
 * nobody said, which is never the same as no.
 */

export interface PricingFromCall {
  /** Date the price stops being good, from the validity in days. */
  quoteExpiresOn: string | null;
  paymentTerms: string | null;
  leadTimeDays: number | null;
  availability: string | null;
  alternates: string[];
  /**
   * What the price does not cover, in the subcontractor's terms.
   *
   * Assembled from the three yes/no answers plus whatever the operator typed,
   * because "the price excludes sales tax" is a sentence a bid reviewer can
   * act on and `taxes_included: false` is a field they have to interpret.
   */
  exclusions: string[];
}

/**
 * Whatever the call record holds, read defensively.
 *
 * `unknown` rather than a union: the values arrive from a jsonb column written
 * by earlier builds of the workspace, and a type that promised otherwise would
 * be a promise the database has never made. Every reader below narrows.
 */
type Answers = Record<string, unknown>;

function text(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  const n = Number(s.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * A yes/no answer, where "not asked" and "no" are different values.
 *
 * The guide stores these as the strings "yes" and "no". Anything else is
 * nobody having said, and the difference matters: an unasked tax question must
 * not produce an exclusion the subcontractor never stated.
 */
function yesNo(v: unknown): boolean | null {
  const s = String(v ?? "").toLowerCase().trim();
  if (s === "yes" || s === "true") return true;
  if (s === "no" || s === "false") return false;
  return null;
}

/** ISO date `days` from `from`, or null when no validity was given. */
export function expiryFrom(days: number | null, from: Date): string | null {
  if (days == null || !Number.isFinite(days) || days <= 0) return null;
  const d = new Date(from.getTime() + Math.round(days) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function pricingFromCall(answers: Answers, now: Date): PricingFromCall {
  const exclusions: string[] = [];
  /*
   * Only a stated "no" becomes an exclusion. An unanswered question produces
   * nothing at all, because writing "excludes sales tax" on the strength of a
   * question nobody asked is the platform putting words in a subcontractor's
   * mouth, and it is the sort of thing a bid reviewer relies on.
   */
  if (yesNo(answers.taxes_included) === false) exclusions.push("Sales tax is not included.");
  if (yesNo(answers.freight_included) === false) {
    exclusions.push("Delivery of materials to site is not included.");
  }
  if (yesNo(answers.mobilization_included) === false) {
    exclusions.push("Getting their crew and equipment to site is not included.");
  }
  const stated = text(answers.assumptions);
  if (stated) exclusions.push(stated);

  const alternates: string[] = [];
  const alt = text(answers.alternates);
  if (alt) alternates.push(alt);

  const weeks = num(answers.lead_time_weeks);

  return {
    quoteExpiresOn: expiryFrom(num(answers.quote_validity_days), now),
    paymentTerms: text(answers.payment_terms),
    leadTimeDays: weeks == null ? null : Math.round(weeks * 7),
    availability: text(answers.availability),
    alternates,
    exclusions,
  };
}

/** True when the call learned nothing worth writing to a pricing row. */
export function isEmptyCapture(p: PricingFromCall): boolean {
  return (
    p.quoteExpiresOn == null &&
    p.paymentTerms == null &&
    p.leadTimeDays == null &&
    p.availability == null &&
    p.alternates.length === 0 &&
    p.exclusions.length === 0
  );
}
