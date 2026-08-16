/**
 * What an organization is allowed to do right now.
 *
 * The trial is deliberately cardless: someone evaluating a $497/month platform
 * for federal contracting should be able to point it at real SAM.gov
 * opportunities and see what it finds before they hand over a card. The cost
 * of that decision is that the trial has to be limited, and the limit has to
 * bite in the places that spend money or touch third parties, not in the
 * places that demonstrate value.
 *
 * Three levels, and the whole application reads them from here:
 *
 *   full  - paid, or a Stripe trial with a card on file. No limits.
 *   trial - the cardless 7-day trial. Everything works; a few metered actions
 *           stop at a quota (see trial-limits.ts).
 *   none  - trial expired, payment failed, or cancelled. Read nothing, run
 *           nothing. The account still exists and one payment restores it.
 *
 * Statuses are stored in organizations.subscription_status. Stripe owns the
 * ones it sets ('active', 'past_due', ...); the two below are ours, and are
 * named so they can never be confused with Stripe's:
 *
 *   'trial'         - our cardless trial. Stripe knows nothing about this org.
 *   'trial_expired' - the cardless trial ran out without an upgrade.
 *
 * Stripe's own 'trialing' remains supported and grants full access: it means a
 * card is already on file and the charge is automatic, which is a stronger
 * commitment than our cardless trial, not a weaker one.
 *
 * Two flags sit outside the status entirely, on their own columns:
 *
 *   billing_exempt - full access, permanently, whatever Stripe thinks. The
 *                    platform owner's own organization and any comped account.
 *                    Not a status value on purpose: every webhook rewrites
 *                    subscription_status, so a 'comped' status would be erased
 *                    the first time Stripe mentioned the account.
 *   suspended_at   - an administrative stop. Outranks the exemption.
 */
import { TRIAL_DAYS } from "./catalog";

export type AccessLevel = "full" | "trial" | "none";

/** Our cardless trial, before it lapses. */
export const TRIAL_STATUS = "trial";
/** Our cardless trial, after it lapses without an upgrade. */
export const TRIAL_EXPIRED_STATUS = "trial_expired";

/**
 * Statuses that grant unmetered access.
 *
 * past_due is deliberately in this set. It means a renewal charge failed and
 * Stripe is retrying, and the most common cause is an expired card, not a
 * customer leaving. Locking the product here stopped a paying customer's
 * agents mid-bid over a decline that Stripe's own retries usually recover
 * within days, which for a deadline-driven product turns a card hiccup into a
 * missed federal submission. The state is bounded by Stripe itself: when
 * dunning exhausts, the subscription moves to 'unpaid' or 'canceled', neither
 * of which is in this set, and access ends then. While past_due, the customer
 * is emailed (notifyPaymentFailed) and shown an in-app banner pointing at the
 * billing portal.
 */
const FULL = new Set(["active", "trialing", "past_due"]);

export interface EntitlementInput {
  subscription_status: string | null | undefined;
  trial_ends_at?: string | Date | null;
  /**
   * Full access regardless of subscription. The platform owner's own
   * organization, and any account an admin has comped.
   */
  billing_exempt?: boolean | null;
  /** Administrative suspension. Outranks everything, including the exemption. */
  suspended_at?: string | Date | null;
}

/**
 * The access level for an organization.
 *
 * A trial whose end date has passed reads as `none` even if the expiry sweep
 * has not run yet. The sweep keeps the stored status tidy for queries and
 * admin views; this function is what actually gates behaviour, so a sweep that
 * is late (or wedged) can never hand out free access.
 *
 * Order matters. Suspension is checked before the exemption because suspension
 * is a deliberate administrative act and an exempt account must not be able to
 * ignore it. The exemption is then checked before any status or date, because
 * its entire purpose is to be immune to both: the platform owner's own
 * organization reads 'canceled' in Stripe's eyes and must still work.
 */
export function accessLevel(org: EntitlementInput, now = new Date()): AccessLevel {
  if (isSuspended(org)) return "none";
  if (org.billing_exempt) return "full";
  const status = org.subscription_status ?? "";
  if (FULL.has(status)) return "full";
  if (status === TRIAL_STATUS) {
    return trialHasEnded(org, now) ? "none" : "trial";
  }
  return "none";
}

/** True when an admin has suspended the organization. */
export function isSuspended(org: EntitlementInput): boolean {
  return Boolean(org.suspended_at);
}

/**
 * Build an entitlement input from a session user.
 *
 * Structurally typed rather than importing SessionUser, which would make
 * lib/auth and this module circular. Every gate should go through this so a
 * new field (the exemption was one) reaches all of them at once instead of
 * being remembered at each call site.
 */
export function entitlementOf(user: {
  subscriptionStatus?: string | null;
  trialEndsAt?: string | null;
  billingExempt?: boolean | null;
  suspendedAt?: string | null;
}): EntitlementInput {
  return {
    subscription_status: user.subscriptionStatus ?? null,
    trial_ends_at: user.trialEndsAt ?? null,
    billing_exempt: user.billingExempt ?? false,
    suspended_at: user.suspendedAt ?? null,
  };
}

/** Whether this organization may use the product at all. */
export function hasAccess(org: EntitlementInput, now = new Date()): boolean {
  return accessLevel(org, now) !== "none";
}

/** True when a cardless trial's window has closed. */
export function trialHasEnded(org: EntitlementInput, now = new Date()): boolean {
  if (!org.trial_ends_at) {
    // A trial row with no end date is a bug rather than an unlimited trial.
    // Treat it as ended: refusing access is recoverable in a support message,
    // handing out an unlimited free account is not.
    return true;
  }
  const ends = new Date(org.trial_ends_at).getTime();
  if (Number.isNaN(ends)) return true;
  return ends <= now.getTime();
}

/** Whole days left in the trial, floored at zero. Zero means the last day. */
export function trialDaysLeft(org: EntitlementInput, now = new Date()): number {
  if (!org.trial_ends_at) return 0;
  const ends = new Date(org.trial_ends_at).getTime();
  if (Number.isNaN(ends)) return 0;
  return Math.max(0, Math.ceil((ends - now.getTime()) / 86_400_000));
}

/** When a trial starting now should end. */
export function trialEndsAt(now = new Date()): Date {
  return new Date(now.getTime() + TRIAL_DAYS * 86_400_000);
}

/** True when the org is on our cardless trial (whether or not it has lapsed). */
export function isCardlessTrial(org: EntitlementInput): boolean {
  const s = org.subscription_status ?? "";
  return s === TRIAL_STATUS || s === TRIAL_EXPIRED_STATUS;
}

/**
 * One line explaining why access is blocked, written for the person who hit
 * it rather than for a log.
 */
export function accessBlockedReason(org: EntitlementInput, now = new Date()): string {
  if (isSuspended(org)) {
    return "This account has been suspended. Contact support to have it reinstated; nothing has been deleted.";
  }
  const status = org.subscription_status ?? "none";
  if (status === TRIAL_STATUS || status === TRIAL_EXPIRED_STATUS) {
    return "Your free trial has ended. Choose a plan to pick up exactly where you left off, with everything you set up still here.";
  }
  switch (status) {
    case "past_due":
    case "unpaid":
      return "Your last payment did not go through. Update your card to restore access.";
    case "canceled":
      return "Your subscription was cancelled. Choose a plan to start again.";
    case "incomplete":
    case "incomplete_expired":
      return "Your subscription was never completed. Choose a plan to finish signing up.";
    default:
      return "This account does not have an active subscription yet. Choose a plan to get started.";
  }
}
