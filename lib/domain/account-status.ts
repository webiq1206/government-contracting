/**
 * Six different questions about an account, answered separately so they can
 * never appear to contradict each other.
 *
 * They were being answered by one value. `subscription_status` was read as
 * "can this account work", "is it being charged", "what does Stripe think"
 * and "is the trial live" all at once, and it is only honestly the third of
 * those. The visible cost was on comped accounts, which are the platform
 * owner's own organization and every account given free access: Stripe
 * records them as `canceled` or knows nothing about them at all, so a billing
 * page that reads the status straight told the owner of a perfectly working
 * account that it was cancelled, beside a button offering to reactivate it.
 *
 * The questions really are separate, and pretending otherwise is what makes
 * the answers fight:
 *
 *   productAccess  what the account can do right now
 *   billing        whether money is changing hands, and how
 *   trial          whether a trial is running, and how much is left
 *   stripe         what the payment processor believes, verbatim
 *   automation     whether the agents are allowed to run
 *   effective      the one line to lead with
 *
 * `stripe` is deliberately the raw truth rather than a friendly summary. When
 * support is looking at an account that will not behave, "Stripe says
 * incomplete_expired" is the fact that solves it, and softening it into
 * "Inactive" throws that away. Every other field is written for the customer;
 * this one is written for whoever has to explain it.
 *
 * Pure.
 */

export type ProductAccess = "full" | "trial" | "none";

export interface AccountFacts {
  /** Stripe's status, or one of ours ('trial', 'trial_expired'). */
  subscriptionStatus?: string | null;
  trialEndsAt?: string | Date | null;
  /** Free access by arrangement. Outranks anything Stripe says. */
  billingExempt?: boolean | null;
  /** An administrative stop. Outranks the exemption. */
  suspendedAt?: string | Date | null;
  /** Whether Stripe has ever seen this account. */
  stripeCustomerId?: string | null;
  /** What they are actually charged, in cents, when Stripe knows. */
  amountCents?: number | null;
  billingInterval?: "month" | "year" | string | null;
  /** Master automation switch, which is a choice rather than a status. */
  automationPaused?: boolean;
  now?: Date;
}

export interface StatusLine {
  /** The short answer, for a definition list. */
  value: string;
  /** Why, when the short answer alone would raise a question. */
  detail?: string;
  tone: "good" | "warn" | "bad" | "neutral";
}

export interface AccountStatus {
  productAccess: StatusLine;
  billing: StatusLine;
  trial: StatusLine;
  stripe: StatusLine;
  automation: StatusLine;
  /** One sentence, the thing to put at the top of the page. */
  effective: StatusLine;
  /** Whether to offer checkout, a plan picker, or prices at all. */
  showPurchase: boolean;
  /** Whether to offer the Stripe customer portal. */
  showPortal: boolean;
  access: ProductAccess;
}

const FULL_STATUSES = new Set(["active", "trialing", "past_due"]);

function asDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Whole days remaining, floored at zero. Never negative on screen. */
export function daysLeft(endsAt: string | Date | null | undefined, now: Date): number {
  const end = asDate(endsAt);
  if (!end) return 0;
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86_400_000));
}

export function accountStatus(facts: AccountFacts): AccountStatus {
  const now = facts.now ?? new Date();
  const status = facts.subscriptionStatus ?? "";
  const suspended = Boolean(asDate(facts.suspendedAt));
  const comped = Boolean(facts.billingExempt);
  const onOurTrial = status === "trial";
  const trialEnd = asDate(facts.trialEndsAt);
  const trialLive = onOurTrial && trialEnd != null && trialEnd.getTime() > now.getTime();
  const knownToStripe = Boolean(facts.stripeCustomerId);

  // Access first, and in this order, because the order is the precedence:
  // suspension is a deliberate act that an exemption must not override, and
  // the exemption exists precisely to override everything below it.
  const access: ProductAccess = suspended
    ? "none"
    : comped
      ? "full"
      : FULL_STATUSES.has(status)
        ? "full"
        : trialLive
          ? "trial"
          : "none";

  const productAccess: StatusLine = suspended
    ? { value: "Suspended", detail: "An administrator has stopped this account. Nothing runs and nothing can be edited.", tone: "bad" }
    : access === "full"
      ? { value: "Full access", detail: "Every feature is available with no limits.", tone: "good" }
      : access === "trial"
        ? {
            value: "Trial access",
            detail: `Everything works. A few metered actions stop at a quota until the account is upgraded.`,
            tone: "warn",
          }
        : {
            value: "No access",
            detail:
              status === "trial_expired" || onOurTrial
                ? "The trial has ended. One payment restores everything; nothing has been deleted."
                : "The subscription is not active. One payment restores everything; nothing has been deleted.",
            tone: "bad",
          };

  const price =
    facts.amountCents != null
      ? `$${(facts.amountCents / 100).toLocaleString("en-US")} ${
          facts.billingInterval === "year" ? "per year" : "per month"
        }`
      : null;

  const billing: StatusLine = comped
    ? {
        // The exact wording the audit asked for, because it is the wording
        // that stops the question: not "no subscription", which reads as a
        // problem, but "none required", which reads as an arrangement.
        value: "No billing required",
        detail: "This account has been given full access. There is nothing to pay and no card on file.",
        tone: "good",
      }
    : status === "past_due"
      ? {
          value: "Payment failed, retrying",
          detail:
            "A renewal charge was declined and is being retried automatically. Access continues while that happens. Updating the card ends it sooner.",
          tone: "warn",
        }
      : status === "unpaid"
        ? { value: "Unpaid", detail: "Retries have run out. Access has stopped until a payment succeeds.", tone: "bad" }
        : status === "canceled" || status === "incomplete_expired"
          ? { value: "Cancelled", detail: "No further charges will be made.", tone: "neutral" }
          : status === "active" || status === "trialing"
            ? { value: price ? `Paying ${price}` : "Paying", tone: "good" }
            : trialLive
              ? { value: "No card on file", detail: "The trial does not require one.", tone: "neutral" }
              : { value: "Not set up", detail: "No payment method has been added.", tone: "neutral" };

  const trial: StatusLine = comped
    ? { value: "Not applicable", detail: "Comped accounts do not run a trial.", tone: "neutral" }
    : trialLive
      ? (() => {
          const left = daysLeft(trialEnd, now);
          return {
            value: left === 1 ? "1 day left" : `${left} days left`,
            detail: "The free trial does not need a card. Adding one before it ends avoids any interruption.",
            tone: left <= 2 ? "warn" : "neutral",
          } as StatusLine;
        })()
      : status === "trial_expired" || (onOurTrial && !trialLive)
        ? { value: "Ended", detail: trialEnd ? `The trial ran out on ${trialEnd.toISOString().slice(0, 10)}.` : undefined, tone: "bad" }
        : status === "trialing"
          ? { value: "Stripe trial, card on file", detail: "Billing starts automatically when it ends.", tone: "good" }
          : { value: "Not on trial", tone: "neutral" };

  const stripe: StatusLine = !knownToStripe
    ? {
        value: comped ? "Not applicable" : "No Stripe customer",
        detail: comped
          ? "This account has never needed a payment processor record."
          : "This account has never been through checkout.",
        tone: "neutral",
      }
    : {
        // Verbatim on purpose. This row exists for whoever has to explain the
        // account, and a softened word is the one thing that cannot help them.
        value: status || "unknown",
        detail: comped
          ? "Stripe's own view. It does not affect this account, which has been comped."
          : "Stripe's own view of the subscription.",
        tone: comped ? "neutral" : FULL_STATUSES.has(status) ? "good" : "warn",
      };

  const automation: StatusLine = facts.automationPaused
    ? { value: "Paused by choice", detail: "Someone turned automation off. Turning it back on resumes everything.", tone: "warn" }
    : access === "none"
      ? { value: "Stopped", detail: "Automation does not run without access.", tone: "bad" }
      : access === "trial"
        ? { value: "Running, with trial quotas", detail: "Metered actions stop at a quota until the account is upgraded.", tone: "warn" }
        : { value: "Allowed to run", detail: "Whether it IS running is on the Automation Health page.", tone: "good" };

  const effective: StatusLine = suspended
    ? { value: "Suspended", detail: productAccess.detail, tone: "bad" }
    : comped
      ? { value: "Full access, no billing required", tone: "good" }
      : access === "full"
        ? { value: price ? `Active, ${price}` : "Active", tone: "good" }
        : access === "trial"
          ? { value: `Trial, ${trial.value.toLowerCase()}`, tone: "warn" }
          : { value: "No access", detail: productAccess.detail, tone: "bad" };

  return {
    productAccess,
    billing,
    trial,
    stripe,
    automation,
    effective,
    // A comped account has nothing to buy, and an account already in Stripe
    // buys through the portal rather than a second checkout. Offering either
    // in the wrong case is how somebody who was told their account is free
    // ends up paying for it.
    showPurchase: !comped && !suspended && !knownToStripe,
    showPortal: !comped && knownToStripe,
    access,
  };
}
