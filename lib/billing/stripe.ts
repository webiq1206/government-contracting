/**
 * Stripe Billing helpers for Brost Co SaaS subscriptions.
 * Gracefully disabled when STRIPE_SECRET_KEY is unset (local/dev).
 * The Stripe SDK is required only when a secret key is present.
 */
import { config } from "../config";
import { stripeEnabled } from "./enabled";
import {
  priceIdFor,
  type BillingInterval,
} from "./catalog";

export { stripeEnabled };

/** Minimal Stripe client shape used by this module (avoids a hard SDK import). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StripeClient = any;

export function getStripe(): StripeClient | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  try {
    // Lazy require so pages that only check stripeEnabled() still compile when
    // the optional SDK is not installed in a local workspace.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const StripeCtor = require("stripe");
    return new StripeCtor(key, { apiVersion: "2026-07-29.dahlia" });
  } catch {
    return null;
  }
}

/**
 * Checkout for one plan and interval.
 *
 * Refuses rather than improvising. The previous version created a brand new
 * Stripe product and price on the fly whenever the configured price ID was
 * missing, which in production meant a duplicate product per checkout and a
 * price nobody had approved.
 */
export async function createCheckoutSession(input: {
  orgId: string;
  customerEmail: string;
  customerId?: string | null;
  plan: "founding" | "standard";
  interval: BillingInterval;
  successUrl: string;
  cancelUrl: string;
  /** Enable Stripe's promotion-code box. Stripe enforces validity and expiry. */
  allowPromotionCodes?: boolean;
  /**
   * A discount we already promised this account, applied without them having
   * to type anything.
   *
   * A coupon rather than a promotion code, on purpose: a coupon can only be
   * attached here, by us, for this account. A promotion code would be a string
   * anybody could type into the box on somebody else's checkout.
   *
   * Stripe will not accept this and `allow_promotion_codes` in the same
   * session, so passing it turns the code box off. That is the right way
   * round: somebody who was given terms should not be able to stack a second
   * code on top, and the terms they were promised are already applied.
   */
  couponId?: string | null;
  /**
   * Stripe-side trial days. Defaults to none, because the free trial now
   * happens BEFORE checkout and is cardless: someone reaching this page has
   * already had their 7 days and is choosing to start paying. Granting a
   * second trial here would silently double every trial to 14 days.
   */
  trialDays?: number;
}): Promise<{ url: string | null; error?: string }> {
  const stripe = getStripe();
  if (!stripe) return { url: null, error: "Stripe is not configured." };

  const priceId = priceIdFor(input.plan, input.interval);
  if (!priceId) {
    return {
      url: null,
      error: `No Stripe price is configured for the ${input.plan} plan billed ${input.interval === "year" ? "annually" : "monthly"}. Run the Stripe setup script and set the price ID.`,
    };
  }

  // Stripe rejects a session outright for reasons the caller cannot predict
  // (a product missing its tax code under Managed Payments, an archived price,
  // an account restriction). Catch it here so the route redirects with a
  // readable message instead of letting the exception become a blank browser
  // error page on the customer's first attempt to pay.
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: input.customerId || undefined,
      customer_email: input.customerId ? undefined : input.customerEmail,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.orgId,
      // A card is always collected here: this is the upgrade, not the trial.
      payment_method_collection: "always",
      metadata: {
        org_id: input.orgId,
        plan_key: input.plan,
        interval: input.interval,
      },
      subscription_data: {
        ...(input.trialDays && input.trialDays > 0
          ? { trial_period_days: input.trialDays }
          : {}),
        metadata: {
          org_id: input.orgId,
          plan_key: input.plan,
          interval: input.interval,
        },
      },
      // Discount eligibility and expiry are Stripe's to enforce. Keeping that
      // logic out of our code is the point: an expired code fails at Stripe.
      // One or the other, never both: Stripe rejects a session carrying a
      // discount and an open code box together.
      ...(input.couponId
        ? { discounts: [{ coupon: input.couponId }] }
        : { allow_promotion_codes: input.allowPromotionCodes ?? true }),
    });
    return { url: session.url };
  } catch (err) {
    return { url: null, error: (err as Error).message };
  }
}

export async function createBillingPortalSession(input: {
  customerId: string;
  returnUrl: string;
}): Promise<{ url: string | null; error?: string }> {
  const stripe = getStripe();
  if (!stripe) return { url: null, error: "Stripe is not configured." };
  const session = await stripe.billingPortal.sessions.create({
    customer: input.customerId,
    return_url: input.returnUrl,
  });
  return { url: session.url };
}

export function appBaseUrl(): string {
  return config.appUrl.replace(/\/$/, "");
}
