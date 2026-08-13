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
 */
import { TRIAL_DAYS } from "./catalog";

export type AccessLevel = "full" | "trial" | "none";

/** Our cardless trial, before it lapses. */
export const TRIAL_STATUS = "trial";
/** Our cardless trial, after it lapses without an upgrade. */
export const TRIAL_EXPIRED_STATUS = "trial_expired";

/** Statuses that grant unmetered access. */
const FULL = new Set(["active", "trialing"]);

export interface EntitlementInput {
  subscription_status: string | null | undefined;
  trial_ends_at?: string | Date | null;
}

/**
 * The access level for an organization.
 *
 * A trial whose end date has passed reads as `none` even if the expiry sweep
 * has not run yet. The sweep keeps the stored status tidy for queries and
 * admin views; this function is what actually gates behaviour, so a sweep that
 * is late (or wedged) can never hand out free access.
 */
export function accessLevel(org: EntitlementInput, now = new Date()): AccessLevel {
  const status = org.subscription_status ?? "";
  if (FULL.has(status)) return "full";
  if (status === TRIAL_STATUS) {
    return trialHasEnded(org, now) ? "none" : "trial";
  }
  return "none";
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
