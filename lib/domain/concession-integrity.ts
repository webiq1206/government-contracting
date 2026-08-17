/**
 * Do the terms we promised actually exist?
 *
 * Three ways a hand-negotiated deal quietly fails to be real, all of which
 * the customer discovers on an invoice rather than we do:
 *
 *   - an invitation nobody accepted, whose link expires without a word, so a
 *     deal that was agreed on a phone call simply evaporates
 *   - an accepted invitation whose terms never landed, which migration 048
 *     records but leaves for someone to notice and fix by hand
 *   - a granted discount that never reached Stripe, or reached it and is not
 *     on the invoice the customer is actually charged
 *
 * The decisions live here, pure, because each one is a money decision and the
 * cost of getting them wrong is asymmetric: failing to nudge is a lost sale,
 * but re-applying a discount that was already applied is a double discount,
 * and re-writing terms onto an account that has since moved on is worse than
 * leaving it alone. Every rule below is written to fail toward "leave it and
 * tell a human".
 */

export type ConcessionKind = "none" | "percent" | "free_months" | "free_account";

export interface InvitationSnapshot {
  id: string;
  email: string;
  concession_kind: ConcessionKind | string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  terms_applied_at: string | null;
  accepted_org_id: string | null;
  /** How many times the link has been issued, including the first send. */
  sent_count: number;
}

export interface OrgSnapshot {
  id: string;
  stripe_subscription_id: string | null;
  billing_exempt: boolean;
  /** Mirror of the discount Stripe reports. Null means none is live. */
  discount_percent_off: number | null;
  discount_ends_at: string | null;
  /** The promise held before there is a subscription to attach it to. */
  pending_coupon_id: string | null;
}

// ---------------------------------------------------------------------------
// 1. Nudging an invitation before its link dies
// ---------------------------------------------------------------------------

/** Inside this many days of expiry, a pending invitation is worth a nudge. */
export const NUDGE_WINDOW_DAYS = 3;

/**
 * How many times we will re-issue before letting it lapse.
 *
 * Re-sending mints a fresh token and a fresh expiry, so an unlimited nudge
 * would keep an unwanted invitation alive forever and make "expires" a lie.
 * One reminder is a courtesy; a second is pestering somebody who has already
 * decided.
 */
export const MAX_NUDGES = 1;

export type NudgeDecision =
  | { nudge: true; daysLeft: number }
  | { nudge: false; reason: string };

export function nudgeDecision(
  inv: InvitationSnapshot,
  now: Date = new Date()
): NudgeDecision {
  if (inv.accepted_at) return { nudge: false, reason: "already accepted" };
  if (inv.revoked_at) return { nudge: false, reason: "withdrawn" };

  const expires = new Date(inv.expires_at).getTime();
  if (!Number.isFinite(expires)) return { nudge: false, reason: "no expiry on file" };

  const msLeft = expires - now.getTime();
  if (msLeft <= 0) return { nudge: false, reason: "already expired" };

  const daysLeft = Math.ceil(msLeft / 86_400_000);
  if (daysLeft > NUDGE_WINDOW_DAYS) {
    return { nudge: false, reason: `${daysLeft} days left, too early` };
  }
  // sent_count counts the original send, so the first nudge takes it to 2.
  if (inv.sent_count > MAX_NUDGES) {
    return { nudge: false, reason: "already reminded once" };
  }
  return { nudge: true, daysLeft };
}

// ---------------------------------------------------------------------------
// 2. Terms that never landed on the account
// ---------------------------------------------------------------------------

export type RepairAction =
  | { action: "none"; reason: string }
  /** Write the promised plan and hold the discount for checkout. */
  | { action: "apply_pending_terms" }
  /** Set our own free-account flag. */
  | { action: "apply_free_account" }
  /** Live subscription with no discount: attach the coupon at Stripe. */
  | { action: "attach_coupon_to_subscription" }
  /** Something a human has to look at; never guessed at automatically. */
  | { action: "needs_human"; reason: string };

/**
 * What an accepted invitation whose terms never landed actually needs.
 *
 * The awkward case is an account that has since started paying. The pending
 * columns are read at checkout, so writing them now would do nothing for a
 * subscription that already exists; the fix there is a coupon on the live
 * subscription. But if that subscription already carries a discount we did
 * not put there, adding another is how a customer ends up with two, so that
 * one stops and asks.
 */
export function repairAction(
  inv: InvitationSnapshot,
  org: OrgSnapshot | null
): RepairAction {
  if (!inv.accepted_at) return { action: "none", reason: "not accepted yet" };
  if (inv.terms_applied_at) return { action: "none", reason: "terms already applied" };
  if (inv.revoked_at) return { action: "none", reason: "withdrawn" };
  if (!inv.accepted_org_id || !org) {
    return { action: "needs_human", reason: "accepted but no account on file" };
  }

  if (inv.concession_kind === "free_account") {
    if (org.billing_exempt) return { action: "none", reason: "already a free account" };
    return { action: "apply_free_account" };
  }

  if (inv.concession_kind === "none") {
    // Nothing was promised beyond a plan, so the pending write is safe and
    // still worth doing: it is what binds checkout to the agreed plan.
    return org.stripe_subscription_id
      ? { action: "none", reason: "already subscribed on its own terms" }
      : { action: "apply_pending_terms" };
  }

  if (!org.stripe_subscription_id) return { action: "apply_pending_terms" };

  if (org.discount_percent_off != null) {
    return {
      action: "needs_human",
      reason: "already subscribed with a discount; a second one would stack",
    };
  }
  return { action: "attach_coupon_to_subscription" };
}

// ---------------------------------------------------------------------------
// 3. Did the discount actually reach Stripe, and the invoice?
// ---------------------------------------------------------------------------

export interface StripeDiscountState {
  /** Coupon id Stripe reports on the subscription, if any. */
  subscriptionCouponId: string | null;
  /** Percent off Stripe reports on the subscription, if any. */
  subscriptionPercentOff: number | null;
  /**
   * Discount total on the invoice the customer is actually charged, in cents.
   * Null when no invoice has been issued yet, which is not a failure.
   */
  invoiceDiscountCents: number | null;
}

export type DiscountVerdict =
  | { ok: true; note: string }
  | { ok: false; problem: string; severity: "warn" | "error" };

/**
 * Compare what we believe about a discount with what Stripe says.
 *
 * "Reaches Stripe" and "lands on the right invoice" are two separate
 * failures. A coupon can be attached to a subscription and still not reduce
 * the bill, because it applied to a different subscription, expired before
 * the period billed, or was replaced by a webhook. Checking only the first
 * would report success on an invoice the customer is disputing.
 */
export function discountVerdict(
  org: OrgSnapshot,
  stripe: StripeDiscountState
): DiscountVerdict {
  const expected = org.pending_coupon_id;

  if (!org.stripe_subscription_id) {
    return expected
      ? { ok: true, note: "Discount is promised and waiting for checkout." }
      : { ok: true, note: "No subscription and nothing promised." };
  }

  const mirrored = org.discount_percent_off != null;
  const atStripe = stripe.subscriptionCouponId != null;

  if (expected && !atStripe) {
    return {
      ok: false,
      severity: "error",
      problem:
        "A discount was granted and the account is now subscribed, but Stripe reports no coupon on the subscription. They are being charged full price.",
    };
  }

  if (mirrored && !atStripe) {
    return {
      ok: false,
      severity: "error",
      problem:
        "Our records show a live discount that Stripe does not have. The mirror is stale and the customer is paying full price.",
    };
  }

  if (atStripe && !mirrored) {
    return {
      ok: false,
      severity: "warn",
      problem:
        "Stripe is applying a discount our records do not show. The customer is charged correctly, but nothing here explains why.",
    };
  }

  if (
    atStripe &&
    mirrored &&
    stripe.subscriptionPercentOff != null &&
    org.discount_percent_off != null &&
    Math.abs(stripe.subscriptionPercentOff - org.discount_percent_off) > 0.01
  ) {
    return {
      ok: false,
      severity: "error",
      problem: `Stripe is discounting ${stripe.subscriptionPercentOff}% where our records say ${org.discount_percent_off}%.`,
    };
  }

  // Attached correctly, but the invoice is where it has to show up.
  if (atStripe && stripe.invoiceDiscountCents === 0) {
    return {
      ok: false,
      severity: "error",
      problem:
        "The coupon is on the subscription but the latest invoice shows no discount at all, so it is not reaching the bill.",
    };
  }

  return {
    ok: true,
    note: atStripe
      ? "Discount is on the subscription and reflected on the invoice."
      : "No discount expected or applied.",
  };
}
