/**
 * The card on file, described honestly.
 *
 * The distinction that matters here is between "there is no card" and "we
 * have never been told what the card is". They look the same on screen and
 * are opposites: the first is a reason a renewal will fail, the second is a
 * gap in this platform's records on an account that is paying perfectly well.
 * Saying the second as the first sends somebody to fix a card that is fine.
 *
 * Pure. No database, no Stripe.
 */

export interface CardFacts {
  brand?: string | null;
  last4?: string | null;
  expMonth?: number | null;
  expYear?: number | null;
  recordedAt?: string | Date | null;
  /** Whether Stripe has ever seen this account at all. */
  knownToStripe?: boolean;
  /** Free by arrangement: there is nothing to charge and no card expected. */
  billingExempt?: boolean | null;
  now?: Date;
}

export interface CardDescription {
  /** The short answer for a definition list. Never a fabricated card. */
  value: string;
  /** Why, when the short answer alone would raise a question. */
  detail?: string;
  /** Set when the card will stop working, or already has. */
  warning?: string;
  tone: "good" | "warn" | "bad" | "neutral";
  /** True when the account should be offered a way to update the card. */
  offerUpdate: boolean;
}

const BRAND_LABEL: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
  diners: "Diners Club",
  jcb: "JCB",
  unionpay: "UnionPay",
};

function brandLabel(brand: string | null | undefined): string {
  if (!brand) return "Card";
  return BRAND_LABEL[brand.toLowerCase()] ?? brand.replace(/_/g, " ");
}

/** Two digits, so 4 reads as 04 rather than as April the fourth. */
function mm(month: number): string {
  return month < 10 ? `0${month}` : String(month);
}

export function describeCard(facts: CardFacts): CardDescription {
  const now = facts.now ?? new Date();

  if (facts.billingExempt) {
    return {
      value: "None needed",
      detail: "Nothing is charged on this account, so no card is held.",
      tone: "neutral",
      offerUpdate: false,
    };
  }

  if (!facts.last4) {
    // Never "None". An account that pays every month has a card; what is
    // missing is this platform's copy of what it looks like.
    return facts.knownToStripe
      ? {
          value: "Not recorded here",
          detail:
            "Stripe holds the payment method for this account. It has not been described to this platform, which happens when the card was added before this page recorded it.",
          tone: "neutral",
          offerUpdate: true,
        }
      : {
          value: "No card on file",
          detail: "This account has never been through checkout.",
          tone: "neutral",
          offerUpdate: false,
        };
  }

  const label = `${brandLabel(facts.brand)} ending ${facts.last4}`;
  const hasExpiry =
    typeof facts.expMonth === "number" &&
    typeof facts.expYear === "number" &&
    facts.expMonth >= 1 &&
    facts.expMonth <= 12;

  if (!hasExpiry) {
    return { value: label, tone: "good", offerUpdate: true };
  }

  const expMonth = facts.expMonth as number;
  const expYear = facts.expYear as number;
  const detail = `Expires ${mm(expMonth)}/${expYear}`;

  // A card is good through the last day of its expiry month.
  const expired =
    expYear < now.getUTCFullYear() ||
    (expYear === now.getUTCFullYear() && expMonth < now.getUTCMonth() + 1);
  if (expired) {
    return {
      value: label,
      detail,
      warning: "This card has expired. The next renewal will be declined until it is replaced.",
      tone: "bad",
      offerUpdate: true,
    };
  }

  const monthsLeft =
    (expYear - now.getUTCFullYear()) * 12 + (expMonth - (now.getUTCMonth() + 1));
  if (monthsLeft <= 1) {
    return {
      value: label,
      detail,
      warning:
        monthsLeft === 0
          ? "This card expires at the end of this month."
          : "This card expires next month.",
      tone: "warn",
      offerUpdate: true,
    };
  }

  return { value: label, detail, tone: "good", offerUpdate: true };
}

/** One invoice line, described without arithmetic the reader has to redo. */
export interface InvoiceFacts {
  number?: string | null;
  status: string;
  amountPaidCents?: number | null;
  amountDueCents?: number | null;
  currency?: string | null;
  issuedAt?: string | null;
  paidAt?: string | null;
  failureReason?: string | null;
}

export interface InvoiceLine {
  /** "Paid", "Refused", "Open", "Voided": what happened, not a Stripe enum. */
  outcome: string;
  tone: "good" | "warn" | "bad" | "neutral";
  /** The money, or null when Stripe recorded no amount. */
  amount: string | null;
  /** Why it failed, when it did. */
  note?: string;
}

export function money(cents: number | null | undefined, currency?: string | null): string | null {
  if (cents == null) return null;
  const code = (currency ?? "usd").toUpperCase();
  const amount = (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return code === "USD" ? `$${amount}` : `${amount} ${code}`;
}

export function describeInvoice(inv: InvoiceFacts): InvoiceLine {
  switch (inv.status) {
    case "paid":
      return {
        outcome: "Paid",
        tone: "good",
        amount: money(inv.amountPaidCents ?? inv.amountDueCents, inv.currency),
      };
    case "open":
      return {
        outcome: "Not yet paid",
        tone: "warn",
        amount: money(inv.amountDueCents, inv.currency),
        note: inv.failureReason ?? undefined,
      };
    case "uncollectible":
      return {
        outcome: "Refused",
        tone: "bad",
        amount: money(inv.amountDueCents, inv.currency),
        note: inv.failureReason ?? "Stripe stopped trying to collect this one.",
      };
    case "void":
      return {
        outcome: "Voided",
        tone: "neutral",
        amount: money(inv.amountDueCents, inv.currency),
        note: "Cancelled before it was charged. Nothing was taken.",
      };
    case "draft":
      return {
        outcome: "Not issued yet",
        tone: "neutral",
        amount: money(inv.amountDueCents, inv.currency),
      };
    default:
      return {
        outcome: inv.status.replace(/_/g, " "),
        tone: "neutral",
        amount: money(inv.amountPaidCents ?? inv.amountDueCents, inv.currency),
        note: inv.failureReason ?? undefined,
      };
  }
}
