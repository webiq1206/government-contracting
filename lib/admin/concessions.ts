/**
 * Changing the terms of an account that already exists.
 *
 * Four operations, all reachable only through `requirePlatformAdmin`, all
 * audited with a reason: give a percentage off, give a run of free months,
 * take a discount away, and make an account free outright.
 *
 * WHERE THE DISCOUNT ACTUALLY LIVES DEPENDS ON WHETHER THEY PAY YET
 *
 * A subscriber gets the coupon attached to their subscription at Stripe, and
 * our columns catch up when the webhook reports it. Somebody still on the
 * cardless trial has no subscription to attach anything to, so the promise is
 * held on the organization and handed to Stripe at checkout instead. Same
 * coupon either way; only the moment of attachment differs.
 *
 * FREE IS NOT A DISCOUNT
 *
 * Converting to free cancels the subscription and sets `billing_exempt`. In
 * that order, and the order is the whole point: cancel-then-exempt fails to a
 * customer who is not being charged and is briefly locked out, which one
 * click fixes. Exempt-then-cancel fails to a customer with a free account who
 * is still being charged for it, which we would only find out about when they
 * noticed.
 */
import { query, queryOne } from "../db";
import { recordAdminAction } from "./audit";
import {
  applyDiscountToSubscription,
  createConcessionCode,
  describeConcession,
  generateConcessionCode,
  removeDiscountFromSubscription,
  validateConcession,
  type Concession,
} from "../billing/concessions";
import { adminAccount, setBillingExempt, type AdminActionResult } from "./accounts";

/**
 * A code nobody else holds.
 *
 * Checked against both places a code can be sitting: an invitation that has
 * not been redeemed, and an account carrying a promise it has not cashed in.
 * Stripe would reject a duplicate anyway, but it would do so after we had
 * already created the coupon, leaving an orphan behind.
 */
export async function reserveConcessionCode(): Promise<string | null> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = generateConcessionCode();
    const clash = await queryOne<{ code: string }>(
      `select concession_code as code from account_invitations where concession_code = $1
        union all
       select pending_concession_code as code from organizations where pending_concession_code = $1
        limit 1`,
      [code]
    ).catch(() => null);
    if (!clash) return code;
  }
  return null;
}

async function clearPending(orgId: string): Promise<void> {
  await query(
    `update organizations
        set pending_concession_code = null,
            pending_coupon_id = null,
            pending_concession_label = null,
            pending_concession_reason = null,
            pending_concession_by = null,
            pending_concession_at = null,
            updated_at = now()
      where id = $1`,
    [orgId]
  );
}

/**
 * Give an existing account a discount.
 *
 * `percent` with no month count runs for the life of the subscription;
 * `free_months` is the same machinery at 100%.
 */
export async function grantConcession(input: {
  orgId: string;
  concession: Concession;
  reason: string;
  adminEmail: string;
}): Promise<AdminActionResult> {
  const problem = validateConcession(input.concession);
  if (problem) return { ok: false, error: problem };
  // Without a reason the audit log records that something was given away and
  // nothing about why, which is the same as not recording it.
  const reason = input.reason.trim();
  if (!reason) return { ok: false, error: "Say why this account is getting a discount." };

  const org = await adminAccount(input.orgId);
  if (!org) return { ok: false, error: "That account no longer exists." };
  if (org.billing_exempt) {
    return {
      ok: false,
      error: `${org.name} is already comped and is not billed at all, so a discount would do nothing. Put it back on normal billing first if it should start paying a reduced rate.`,
    };
  }

  const code = await reserveConcessionCode();
  if (!code) {
    return { ok: false, error: "Could not generate an unused code. Try again." };
  }

  const label = describeConcession(input.concession);
  const created = await createConcessionCode({
    concession: input.concession,
    // Stable for this account and this grant, so a retried request reuses the
    // coupon it already made instead of quietly minting a second one.
    idempotencyKey: `org:${org.id}:${code}`,
    code,
    label: `${org.name}: ${label}`,
  });
  if (!created.ok) {
    return { ok: false, error: `Stripe refused to create the discount: ${created.error}` };
  }

  let note: string;
  if (org.stripe_subscription_id) {
    const applied = await applyDiscountToSubscription({
      subscriptionId: org.stripe_subscription_id,
      couponId: created.value.couponId,
    });
    if (!applied.ok) {
      return {
        ok: false,
        error: `The code was created but Stripe would not put it on the subscription: ${applied.error}. Nothing changed for the customer.`,
      };
    }
    // Stripe now holds the truth. Our discount_* columns fill in when the
    // subscription.updated webhook arrives, the same way a typed promo code
    // has always worked, so there is nothing to write here.
    await clearPending(org.id);
    note = "It applies to their next invoice.";
  } else {
    // Nothing to attach it to yet. Hold the promise until checkout.
    await query(
      `update organizations
          set pending_concession_code = $2,
              pending_coupon_id = $3,
              pending_concession_label = $4,
              pending_concession_reason = $5,
              pending_concession_by = $6,
              pending_concession_at = now(),
              updated_at = now()
        where id = $1`,
      [org.id, created.value.code, created.value.couponId, label, reason, input.adminEmail]
    );
    note = "It applies automatically when they subscribe.";
  }

  await recordAdminAction({
    adminEmail: input.adminEmail,
    action: input.concession.kind === "free_months" ? "free_months_granted" : "discount_applied",
    orgId: org.id,
    orgName: org.name,
    detail: {
      reason,
      terms: label,
      code: created.value.code,
      percent: input.concession.percent ?? null,
      months: input.concession.months ?? null,
      applied_to: org.stripe_subscription_id ? "subscription" : "next checkout",
    },
  });

  return { ok: true, message: `${org.name}: ${label} ${note} Code ${created.value.code}.` };
}

/** Take a discount away, whether it is running at Stripe or still just promised. */
export async function removeConcession(input: {
  orgId: string;
  reason: string;
  adminEmail: string;
}): Promise<AdminActionResult> {
  const org = await adminAccount(input.orgId);
  if (!org) return { ok: false, error: "That account no longer exists." };

  const pending = await queryOne<{ pending_concession_code: string | null }>(
    `select pending_concession_code from organizations where id = $1`,
    [input.orgId]
  ).catch(() => null);

  const hadStripeDiscount = Boolean(org.stripe_subscription_id);
  if (hadStripeDiscount) {
    const removed = await removeDiscountFromSubscription({
      subscriptionId: org.stripe_subscription_id!,
    });
    if (!removed.ok) {
      return {
        ok: false,
        error: `Stripe would not remove the discount: ${removed.error}. Nothing changed here, so what we show still matches what they are charged.`,
      };
    }
    // Clear the mirror straight away rather than waiting for the webhook. The
    // webhook will say the same thing when it arrives; showing a discount we
    // have just cancelled in the meantime would be a bill the customer is not
    // getting.
    await query(
      `update organizations
          set discount_code = null,
              discount_percent_off = null,
              discount_amount_off_cents = null,
              discount_ends_at = null,
              updated_at = now()
        where id = $1`,
      [input.orgId]
    );
  }
  await clearPending(input.orgId);

  await recordAdminAction({
    adminEmail: input.adminEmail,
    action: "discount_removed",
    orgId: org.id,
    orgName: org.name,
    detail: {
      reason: input.reason.trim() || null,
      removed_pending_code: pending?.pending_concession_code ?? null,
      removed_at_stripe: hadStripeDiscount,
    },
  });

  return {
    ok: true,
    message: `${org.name} is back on the normal rate${
      hadStripeDiscount ? " from their next invoice" : ""
    }.`,
  };
}

/**
 * Make an account free.
 *
 * Cancels first, exempts second. See the note at the top of this file: the
 * failure between the two steps has to be the harmless one.
 */
export async function convertToFree(input: {
  orgId: string;
  reason: string;
  adminEmail: string;
}): Promise<AdminActionResult> {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, error: "Say why this account is being made free." };

  const org = await adminAccount(input.orgId);
  if (!org) return { ok: false, error: "That account no longer exists." };
  if (org.billing_exempt) {
    return { ok: false, error: `${org.name} is already free.` };
  }

  let billingNote = "There was no subscription to stop.";
  if (org.stripe_subscription_id) {
    const { cancelSubscription } = await import("./accounts");
    const cancelled = await cancelSubscription({
      orgId: input.orgId,
      adminEmail: input.adminEmail,
    });
    if (!cancelled.ok) {
      return {
        ok: false,
        error: `${cancelled.error} The account has not been made free, because doing so while the subscription is still live would keep charging them for something we had told them was free.`,
      };
    }
    billingNote = "Their subscription has been stopped, so nothing more will be charged.";
  }

  const exempted = await setBillingExempt({
    orgId: input.orgId,
    exempt: true,
    reason,
    adminEmail: input.adminEmail,
  });
  if (!exempted.ok) {
    return {
      ok: false,
      error: `${billingNote} But marking the account free failed: ${exempted.error}. They are not being charged; grant the exemption again to restore their access.`,
    };
  }

  // Any promise of a discount is moot now, and leaving it would apply a coupon
  // to a checkout this account should never reach.
  await clearPending(input.orgId);

  return { ok: true, message: `${org.name} is free. ${billingNote}` };
}
