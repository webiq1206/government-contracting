/**
 * Stripe Billing helpers for Brost Co SaaS subscriptions.
 * Gracefully disabled when STRIPE_SECRET_KEY is unset (local/dev).
 * The Stripe SDK is required only when a secret key is present.
 */
import { config } from "../config";
import { stripeEnabled } from "./enabled";
import {
  FOUNDING_MONTHLY_CENTS,
  FOUNDING_MONTHLY_USD,
  STANDARD_MONTHLY_CENTS,
  STANDARD_MONTHLY_USD,
  type PlanKey,
} from "./prices";

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

export function priceIdForPlan(plan: PlanKey): string | null {
  if (plan === "founding") return process.env.STRIPE_PRICE_FOUNDING || null;
  if (plan === "standard") return process.env.STRIPE_PRICE_STANDARD || null;
  return null;
}

export function planFromPriceId(priceId: string | null | undefined): PlanKey {
  if (!priceId) return "none";
  if (priceId === process.env.STRIPE_PRICE_FOUNDING) return "founding";
  if (priceId === process.env.STRIPE_PRICE_STANDARD) return "standard";
  return "none";
}

export function amountCentsForPlan(plan: PlanKey): number | null {
  if (plan === "founding") return FOUNDING_MONTHLY_CENTS;
  if (plan === "standard") return STANDARD_MONTHLY_CENTS;
  return null;
}

export function amountUsdForPlan(plan: PlanKey): number | null {
  if (plan === "founding") return FOUNDING_MONTHLY_USD;
  if (plan === "standard") return STANDARD_MONTHLY_USD;
  return null;
}

export async function createCheckoutSession(input: {
  orgId: string;
  customerEmail: string;
  customerId?: string | null;
  plan: "founding" | "standard";
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string | null; error?: string }> {
  const stripe = getStripe();
  if (!stripe) return { url: null, error: "Stripe is not configured." };

  let priceId = priceIdForPlan(input.plan);
  // Dev fallback: create an ad-hoc price when env price IDs are not set yet.
  if (!priceId) {
    const product = await stripe.products.create({
      name: input.plan === "founding" ? "Brost Co Founding" : "Brost Co Standard",
      metadata: { plan_key: input.plan },
    });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: amountCentsForPlan(input.plan)!,
      currency: "usd",
      recurring: { interval: "month" },
      metadata: { plan_key: input.plan },
    });
    priceId = price.id;
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: input.customerId || undefined,
    customer_email: input.customerId ? undefined : input.customerEmail,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.orgId,
    metadata: {
      org_id: input.orgId,
      plan_key: input.plan,
      price_locked: input.plan === "founding" ? "true" : "false",
    },
    subscription_data: {
      metadata: {
        org_id: input.orgId,
        plan_key: input.plan,
        price_locked: input.plan === "founding" ? "true" : "false",
      },
    },
    allow_promotion_codes: false,
  });

  return { url: session.url };
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
