/**
 * What happened to the last payment, and what happens next.
 *
 * A past-due account read "Past due" and stopped there. The webhook already
 * had the reason and the retry date, put both into an email, and threw the
 * date away, so the page that email pointed at could not answer the question
 * the email raised. An operator whose card had expired had no way to learn
 * whether their account was about to be cut off tonight or in a week, and the
 * one thing they could usefully do about it was not on the screen.
 *
 * Two rules. A retry is never promised without a date: Stripe does not always
 * supply one, and "we will try again" with no when is worse than saying that
 * this was the last attempt. And the consequence is always stated, because
 * "past due" tells somebody there is a problem without telling them what it
 * costs, and the cost, losing access to a pipeline mid-bid, is the part that
 * decides whether they deal with it today or on Friday.
 */

export type PaymentState =
  | "fine" // nothing owing, nothing failed
  | "action_required" // the bank wants the cardholder to confirm
  | "failed_retrying" // failed, and Stripe will try again on a known date
  | "failed_final" // failed, and nothing further is scheduled
  | "canceling" // still paid up, but ending at the period end
  | "no_billing"; // comped, or never subscribed

export interface PaymentFacts {
  subscriptionStatus?: string | null;
  lastPaymentStatus?: string | null;
  lastPaymentError?: string | null;
  lastPaymentAt?: Date | string | null;
  nextPaymentAttemptAt?: Date | string | null;
  invoiceUrl?: string | null;
  cancelAtPeriodEnd?: boolean | null;
  currentPeriodEnd?: Date | string | null;
  billingExempt?: boolean | null;
  now?: Date;
}

export interface PaymentView {
  state: PaymentState;
  /** Whether this is worth interrupting somebody over. */
  urgent: boolean;
  headline: string;
  /** Why, in the provider's words where there are any. */
  reason: string | null;
  /** What the platform will do next, or that it will do nothing. */
  next: string;
  /** What it costs if nothing changes. */
  consequence: string | null;
  /** Where to go and fix it, when there is somewhere. */
  actionHref: string | null;
  actionLabel: string | null;
}

function asDate(v: Date | string | null | undefined): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "on 4 September", or null. Never "soon", which is not a date. */
function on(d: Date | null): string | null {
  if (!d) return null;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
}

export function paymentState(f: PaymentFacts): PaymentView {
  const now = f.now ?? new Date();
  const status = f.subscriptionStatus ?? null;
  const last = f.lastPaymentStatus ?? null;
  const nextAttempt = asDate(f.nextPaymentAttemptAt);
  const periodEnd = asDate(f.currentPeriodEnd);
  const reason = f.lastPaymentError?.trim() || null;
  const invoiceUrl = f.invoiceUrl?.trim() || null;

  if (f.billingExempt) {
    return {
      state: "no_billing",
      urgent: false,
      headline: "Full access, no billing required",
      reason: null,
      next: "Nothing is charged and nothing renews.",
      consequence: null,
      actionHref: null,
      actionLabel: null,
    };
  }

  // The bank wants the cardholder in person. No retry will help, so it is
  // reported as the thing it is rather than folded in with a failure.
  if (last === "action_required" || status === "incomplete") {
    return {
      state: "action_required",
      urgent: true,
      headline: "Your bank needs you to confirm this payment",
      reason,
      next: "Nothing further happens until you confirm it. Retrying the card on its own will not clear this.",
      consequence: "Access continues for now, and stops if the payment is never completed.",
      actionHref: invoiceUrl ?? "/api/billing/portal",
      actionLabel: invoiceUrl ? "Confirm the payment" : "Open billing portal",
    };
  }

  if (last === "failed" || status === "past_due" || status === "unpaid") {
    const when = on(nextAttempt);
    // Only claim a retry when there is a date on it. Stripe stops scheduling
    // them on the final attempt, and "we will try again" with no when reads as
    // a reason to do nothing.
    const retryingInFuture = nextAttempt != null && nextAttempt.getTime() > now.getTime();
    return {
      state: retryingInFuture ? "failed_retrying" : "failed_final",
      urgent: true,
      headline:
        status === "unpaid"
          ? "This invoice has gone unpaid"
          : "The last payment did not go through",
      reason,
      next: retryingInFuture
        ? `The card will be tried again on ${when}. Updating it before then is usually quicker than waiting.`
        : "No further attempt is scheduled, so this will not clear on its own.",
      consequence:
        "If it is not settled, the account loses access. Nothing is deleted: the profile, opportunities, subcontractors and quotes all stay exactly where they are.",
      actionHref: invoiceUrl ?? "/api/billing/portal",
      actionLabel: invoiceUrl ? "Pay this invoice" : "Update the card",
    };
  }

  if (f.cancelAtPeriodEnd && (status === "active" || status === "trialing")) {
    const when = on(periodEnd);
    return {
      state: "canceling",
      urgent: false,
      headline: when ? `Access continues until ${when}` : "Access continues to the end of this period",
      reason: null,
      next: "Nothing is charged after that, and the subscription does not renew.",
      consequence:
        "After that date the account keeps its data and loses access to the pipeline until a plan is chosen again.",
      actionHref: "/api/billing/portal",
      actionLabel: "Keep the subscription",
    };
  }

  if (status === "active" || status === "trialing") {
    const when = on(periodEnd);
    const paidAt = on(asDate(f.lastPaymentAt));
    return {
      state: "fine",
      urgent: false,
      headline: "Payments are up to date",
      reason: null,
      next: when ? `The next charge is on ${when}.` : "The next charge date is not on file yet.",
      consequence: null,
      actionHref: "/api/billing/portal",
      actionLabel: paidAt ? "See invoices" : "Open billing portal",
    };
  }

  return {
    state: "no_billing",
    urgent: false,
    headline: "No subscription on this account",
    reason: null,
    next: "Nothing is charged, and no card is on file.",
    consequence: null,
    actionHref: null,
    actionLabel: null,
  };
}
