/**
 * Accounts whose access and whose subscription cannot both be right.
 *
 * The admin billing page ended with a sentence telling the reader that
 * anything disagreeing with Stripe meant webhook delivery was failing and was
 * worth checking. That is true, and it left the checking to a person who would
 * have to compare every row by hand, on a page they open when something has
 * already gone wrong. Nobody does that, so nobody found the account that had
 * been past due since March and using the product the whole time.
 *
 * The audit asks for webhook health and access conflicts at the top of this
 * page, and for accounts where product access and Stripe disagree to be
 * flagged. This computes both from records already held, so it costs one page
 * load rather than one Stripe call per organization.
 *
 * A conflict is not an accusation. Several of these are legitimate states
 * somebody chose deliberately, and the point is that a deliberate choice and
 * an accident look identical from the outside: an account comped while a
 * subscription is still billing might be a promise kept badly or a refund
 * waiting to happen, and only a person can say which. So each one states what
 * disagrees and what it costs, and none of them is fixed automatically.
 */

export type ConflictKind =
  | "comped_but_billing"
  | "suspended_but_billing"
  | "stale_past_due"
  | "subscription_without_status"
  | "trial_expired_not_swept"
  | "paying_without_amount";

export interface ReconcileRow {
  org_id: string;
  org_name: string;
  owner_email?: string | null;
  subscription_status: string;
  amount_cents?: number | null;
  billing_interval?: string | null;
  trial_ends_at?: string | null;
  last_payment_at?: string | null;
  last_payment_status?: string | null;
  stripe_subscription_id?: string | null;
  stripe_customer_id?: string | null;
  billing_exempt?: boolean | null;
  suspended_at?: string | null;
}

export interface Conflict {
  kind: ConflictKind;
  orgId: string;
  orgName: string;
  severity: "high" | "medium";
  /** The two facts that cannot both be right, in one sentence. */
  disagreement: string;
  /** Why it matters, in money or in trust. */
  cost: string;
  /** The one thing to do about it. */
  action: string;
}

/**
 * How long an account may sit past due before free use stops being a retry
 * window and starts being a leak.
 *
 * `past_due` grants full access on purpose: a renewal that failed on an
 * expired card should not lock somebody out mid-bid while Stripe retries. But
 * nothing bounded it, and Stripe gives up long before this.
 */
export const PAST_DUE_GRACE_DAYS = 21;

const DAY = 86_400_000;

function ageDays(v: string | Date | null | undefined, now: Date): number | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((now.getTime() - d.getTime()) / DAY);
}

export function reconcile(rows: ReconcileRow[], now = new Date()): Conflict[] {
  const out: Conflict[] = [];
  for (const r of rows) {
    const base = { orgId: r.org_id, orgName: r.org_name };
    const paying = r.subscription_status === "active" || r.subscription_status === "past_due";

    // Charging an account that was told it is free. Whichever way round this
    // happened, somebody is going to notice on a bank statement.
    if (r.billing_exempt && paying && (r.amount_cents ?? 0) > 0) {
      out.push({
        ...base,
        kind: "comped_but_billing",
        severity: "high",
        disagreement: `Comped, and ${article(r.subscription_status)} subscription is still charging ${money(r.amount_cents)}.`,
        cost: "This account was told it pays nothing and is being billed. It will be found on a statement rather than here.",
        action: "Cancel the subscription in Stripe, or lift the exemption. Both cannot be what was intended.",
      });
    }

    // Taking money from somebody who cannot sign in.
    if (r.suspended_at && paying) {
      out.push({
        ...base,
        kind: "suspended_but_billing",
        severity: "high",
        disagreement: `Suspended on ${shortDay(r.suspended_at)}, and still on ${article(r.subscription_status)} subscription.`,
        cost: "The account is being charged for a product it cannot open. That is a refund and a complaint.",
        action: "Cancel or pause the subscription, or restore access. Suspension was meant to stop one of the two.",
      });
    }

    // Past due keeps access on purpose, so a failed renewal does not lock
    // somebody out mid-bid. Nothing ever ended that.
    if (r.subscription_status === "past_due") {
      const age = ageDays(r.last_payment_at, now);
      if (age != null && age > PAST_DUE_GRACE_DAYS) {
        out.push({
          ...base,
          kind: "stale_past_due",
          severity: "high",
          disagreement: `Past due for ${age} days, with full access the whole time.`,
          cost: `Stripe stopped retrying long before now, so this is ${age} days of free use nobody decided to give.`,
          action: "Settle it, cancel it, or comp it deliberately. Leaving it is the only option that is not a decision.",
        });
      }
    }

    // A subscription exists at Stripe and our status never caught up, which is
    // the exact shape a dropped webhook leaves behind.
    if (r.stripe_subscription_id && (r.subscription_status === "none" || !r.subscription_status)) {
      out.push({
        ...base,
        kind: "subscription_without_status",
        severity: "high",
        disagreement: "Has a Stripe subscription, and no subscription status on file.",
        cost: "Every figure shown for this account is wrong, and the customer may be locked out of something they are paying for.",
        action: "Re-send the subscription event from the Stripe dashboard, then check webhook delivery.",
      });
    }

    // The trial sweep should have moved this on. It has not.
    if (r.subscription_status === "trial") {
      const overdue = r.trial_ends_at ? ageDays(r.trial_ends_at, now) : null;
      if (overdue != null && overdue > 1) {
        out.push({
          ...base,
          kind: "trial_expired_not_swept",
          severity: "medium",
          disagreement: `Trial ended ${overdue} days ago and the status is still "trial".`,
          cost: "The sweep that ends trials has not run, or has been failing, so this account and any like it keep trial access indefinitely.",
          action: "Check the trial sweep on Automation Health before changing this account by hand.",
        });
      }
    }

    // Active, and nobody knows what for.
    if (r.subscription_status === "active" && !r.billing_exempt && !(r.amount_cents ?? 0)) {
      out.push({
        ...base,
        kind: "paying_without_amount",
        severity: "medium",
        disagreement: "Active subscription with no price on file.",
        cost: "This account is counted as paying and contributes nothing to revenue, so the totals on this page are understated.",
        action: "Re-send the subscription event, or set the plan amount if this was created by hand.",
      });
    }
  }
  // Worst first, then by name, so the list is stable between loads.
  return out.sort(
    (a, b) =>
      (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1) ||
      a.orgName.localeCompare(b.orgName)
  );
}

/** "an active", "a past_due". Status values are data, so the article is derived. */
function article(status: string): string {
  return /^[aeiou]/i.test(status) ? `an ${status}` : `a ${status}`;
}

function money(cents: number | null | undefined): string {
  if (cents == null) return "an unknown amount";
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function shortDay(v: string | Date): string {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime())
    ? "an unknown date"
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Webhook health
// ---------------------------------------------------------------------------

export type WebhookState = "healthy" | "quiet" | "stale" | "never";

export interface WebhookHealth {
  state: WebhookState;
  label: string;
  detail: string;
  /** True when every figure on the page should be read as possibly out of date. */
  suspect: boolean;
}

/** Past this with paying accounts on file, delivery is more likely broken than quiet. */
export const WEBHOOK_STALE_HOURS = 72;

/**
 * Whether the events that keep this page true are still arriving.
 *
 * Deliberately conditioned on whether there is anything to hear from. A
 * deployment with no paying customers hears nothing from Stripe for weeks at a
 * time and that is correct, so calling it broken would be crying wolf on every
 * new install. With live subscriptions, silence is different.
 */
export function webhookHealth(
  lastEventAt: Date | string | null,
  billableAccounts: number,
  now = new Date()
): WebhookHealth {
  const at = lastEventAt == null ? null : lastEventAt instanceof Date ? lastEventAt : new Date(lastEventAt);
  const valid = at && !Number.isNaN(at.getTime()) ? at : null;
  if (!valid) {
    return billableAccounts > 0
      ? {
          state: "never",
          label: "No Stripe event has ever been recorded",
          detail:
            "There are subscriptions on file, so events should have arrived. Either the webhook endpoint was never registered, or none of its deliveries has reached this deployment. Everything below is whatever was last written by hand.",
          suspect: true,
        }
      : {
          state: "quiet",
          label: "No Stripe events yet",
          detail: "Nothing has subscribed, so there is nothing for Stripe to send. This is expected.",
          suspect: false,
        };
  }
  const hours = (now.getTime() - valid.getTime()) / 3_600_000;
  const ago =
    hours < 1
      ? "in the last hour"
      : hours < 48
        ? `${Math.round(hours)} hours ago`
        : `${Math.round(hours / 24)} days ago`;
  if (hours <= WEBHOOK_STALE_HOURS) {
    return {
      state: "healthy",
      label: `Last Stripe event ${ago}`,
      detail: "Delivery is current, so the figures below are as good as the last event.",
      suspect: false,
    };
  }
  if (billableAccounts === 0) {
    return {
      state: "quiet",
      label: `Last Stripe event ${ago}`,
      detail: "Nothing is subscribed, so there is nothing for Stripe to send. Quiet is correct here.",
      suspect: false,
    };
  }
  return {
    state: "stale",
    label: `Last Stripe event ${ago}`,
    detail: `There are live subscriptions and nothing has arrived for over ${Math.round(WEBHOOK_STALE_HOURS / 24)} days. Renewals, failures and cancellations are all delivered this way, so treat every figure below as possibly out of date until delivery is confirmed.`,
    suspect: true,
  };
}
