import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { resolveTenantOrgId } from "@/lib/tenant";
import { getStripe } from "@/lib/billing/stripe";
import { getOrganization } from "@/lib/organizations";
import { getFoundingPromo } from "@/lib/billing/promo";
import {
  PLANS,
  planPrice,
  priceIdFor,
  planForPriceId,
  type BillingInterval,
} from "@/lib/billing/catalog";
import { trackEvent } from "@/lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Change plan or billing interval on an existing subscription.
 *
 * Stripe remains the system of record: this updates the subscription and lets
 * the webhook write the result back. Updating our own tables here as well
 * would race the webhook and could leave the two disagreeing about what a
 * customer is paying.
 *
 * Proration is deliberate rather than uniform. Moving up charges the
 * difference immediately, which is what someone expects when they ask for more
 * today. Moving down leaves a credit against the next invoice instead of
 * refunding, so nobody can cycle plans to extract cash.
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const orgId = await resolveTenantOrgId();

  const body = (await req.json().catch(() => ({}))) as {
    plan?: string;
    interval?: string;
  };
  const target = body.plan === "founding" ? "founding" : "standard";
  const interval: BillingInterval = body.interval === "year" ? "year" : "month";

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Billing is not available." }, { status: 503 });
  }

  const org = await getOrganization(orgId);
  if (!org?.stripe_subscription_id) {
    return NextResponse.json(
      { error: "There is no subscription to change yet." },
      { status: 400 }
    );
  }

  // The founding rate cannot be claimed by someone who does not already hold
  // it once the window has closed. Without this, any subscriber could POST
  // plan=founding and move themselves onto a promotional price indefinitely.
  if (target === "founding" && org.plan_key !== "founding") {
    const promo = await getFoundingPromo({ startIfMissing: false });
    if (!promo.active) {
      return NextResponse.json(
        { error: "The founding rate is no longer available." },
        { status: 403 }
      );
    }
  }

  // A grandfathered subscriber may change how often they are billed without
  // losing their rate, but may not be moved off it by a plan change.
  if (org.price_locked && target !== org.plan_key) {
    return NextResponse.json(
      {
        error:
          "Your rate is locked for the life of this subscription. Changing plan would forfeit it, so this has to be done deliberately by us.",
      },
      { status: 409 }
    );
  }

  const newPriceId = priceIdFor(target, interval);
  if (!newPriceId) {
    return NextResponse.json(
      {
        error: `The ${target} plan billed ${interval === "year" ? "annually" : "monthly"} is not available.`,
      },
      { status: 400 }
    );
  }

  const sub = await stripe.subscriptions.retrieve(org.stripe_subscription_id);
  const item = sub.items?.data?.[0];
  if (!item) {
    return NextResponse.json({ error: "That subscription looks empty." }, { status: 409 });
  }
  if (item.price?.id === newPriceId) {
    return NextResponse.json({ ok: true, unchanged: true });
  }

  const currentCents = item.price?.unit_amount ?? 0;
  const nextCents = planPrice(target, interval).amountCents;
  const movingUp = nextCents > currentCents;

  try {
    await stripe.subscriptions.update(org.stripe_subscription_id, {
      items: [{ id: item.id, price: newPriceId }],
      proration_behavior: movingUp ? "always_invoice" : "create_prorations",
      // A change must never silently extend or restart a trial.
      trial_end: sub.status === "trialing" ? undefined : "now",
      metadata: { ...(sub.metadata ?? {}), org_id: orgId, plan_key: target, interval },
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Stripe refused the change: ${(err as Error).message}` },
      { status: 502 }
    );
  }

  await trackEvent({
    event: "plan_changed",
    orgId,
    userId: auth.id,
    meta: {
      from: planForPriceId(item.price?.id ?? null),
      to: { plan: target, interval },
      direction: movingUp ? "up" : "down",
    },
  });

  return NextResponse.json({
    ok: true,
    plan: target,
    interval,
    // Said plainly, because the money implication is the thing they care about.
    effect: movingUp
      ? `You have been charged the difference and are on ${PLANS[target].name} now.`
      : `The change is applied and a credit will come off your next invoice.`,
  });
}
