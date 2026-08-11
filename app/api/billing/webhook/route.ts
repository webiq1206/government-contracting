import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe, planFromPriceId, amountCentsForPlan } from "@/lib/billing/stripe";
import { queryOne } from "@/lib/db";
import { updateOrganizationBilling } from "@/lib/organizations";
import { trackEvent } from "@/lib/analytics";
import type { PlanKey } from "@/lib/billing/prices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe webhook. Activates / updates / cancels organization subscriptions.
 * Founding subscribers keep price_locked=true so renewals never silently move
 * to standard pricing.
 */
export async function POST(req: Request) {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const body = await req.text();
  let event: Stripe.Event;
  try {
    if (secret) {
      const sig = req.headers.get("stripe-signature") || "";
      event = stripe.webhooks.constructEvent(body, sig, secret);
    } else {
      event = JSON.parse(body) as Stripe.Event;
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Webhook signature error: ${(err as Error).message}` },
      { status: 400 }
    );
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orgId =
          session.metadata?.org_id || session.client_reference_id || null;
        if (!orgId) break;
        const subId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;
        const customerId =
          typeof session.customer === "string"
            ? session.customer
            : session.customer?.id;
        let plan = (session.metadata?.plan_key as PlanKey) || "standard";
        let priceId: string | null = null;
        let periodEnd: string | null = null;
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          priceId = sub.items.data[0]?.price?.id ?? null;
          plan = planFromPriceId(priceId) !== "none" ? planFromPriceId(priceId) : plan;
          const period = (sub as { current_period_end?: number }).current_period_end;
          periodEnd = period ? new Date(period * 1000).toISOString() : null;
        }
        const priceLocked =
          session.metadata?.price_locked === "true" || plan === "founding";
        await updateOrganizationBilling(orgId, {
          stripe_customer_id: customerId ?? null,
          stripe_subscription_id: subId ?? null,
          stripe_price_id: priceId,
          plan_key: plan,
          plan_amount_cents: amountCentsForPlan(plan),
          subscription_status: "active",
          price_locked: priceLocked,
          current_period_end: periodEnd,
          cancel_at_period_end: false,
        });
        await trackEvent({
          event: "subscription_completed",
          orgId,
          meta: { plan, session_id: session.id },
        });
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const orgId =
          sub.metadata?.org_id ||
          (
            await queryOne<{ id: string }>(
              `select id from organizations where stripe_subscription_id = $1`,
              [sub.id]
            )
          )?.id;
        if (!orgId) break;
        const org = await queryOne<{ price_locked: boolean; plan_key: string }>(
          `select price_locked, plan_key from organizations where id = $1`,
          [orgId]
        );
        const priceId = sub.items.data[0]?.price?.id ?? null;
        let plan = planFromPriceId(priceId);
        // Never unlock or reprice a founding subscriber via webhook updates.
        if (org?.price_locked) {
          plan = (org.plan_key as PlanKey) || "founding";
        } else if (plan === "none") {
          plan = "standard";
        }
        const period = (sub as { current_period_end?: number }).current_period_end;
        const patch: Parameters<typeof updateOrganizationBilling>[1] = {
          stripe_subscription_id: sub.id,
          plan_key: plan,
          plan_amount_cents: amountCentsForPlan(plan),
          subscription_status:
            event.type === "customer.subscription.deleted"
              ? "canceled"
              : sub.status,
          cancel_at_period_end: Boolean(sub.cancel_at_period_end),
          current_period_end: period ? new Date(period * 1000).toISOString() : null,
          price_locked: Boolean(org?.price_locked) || plan === "founding",
        };
        if (!org?.price_locked) patch.stripe_price_id = priceId;
        await updateOrganizationBilling(orgId, patch);
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error("[stripe-webhook]", err);
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
