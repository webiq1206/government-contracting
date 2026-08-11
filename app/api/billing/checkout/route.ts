import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { getFoundingPromo } from "@/lib/billing/promo";
import {
  appBaseUrl,
  createCheckoutSession,
  stripeEnabled,
} from "@/lib/billing/stripe";
import { getOrganization, updateOrganizationBilling } from "@/lib/organizations";
import { amountCentsForPlan } from "@/lib/billing/stripe";
import { trackEvent } from "@/lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) {
    return NextResponse.redirect(new URL("/login", appBaseUrl()));
  }
  if (!auth.organizationId) {
    return NextResponse.redirect(new URL("/signup", appBaseUrl()));
  }

  const url = new URL(req.url);
  const promo = await getFoundingPromo({ startIfMissing: false });
  let plan: "founding" | "standard" =
    url.searchParams.get("plan") === "founding" ? "founding" : "standard";
  if (plan === "founding" && !promo.active) plan = "standard";

  const org = await getOrganization(auth.organizationId);
  if (!org) {
    return NextResponse.redirect(new URL("/signup", appBaseUrl()));
  }

  if (!stripeEnabled()) {
    await updateOrganizationBilling(org.id, {
      plan_key: plan,
      plan_amount_cents: amountCentsForPlan(plan),
      subscription_status: "active",
      price_locked: plan === "founding",
    });
    return NextResponse.redirect(new URL("/today", appBaseUrl()));
  }

  const checkout = await createCheckoutSession({
    orgId: org.id,
    customerEmail: auth.email,
    customerId: org.stripe_customer_id,
    plan,
    successUrl: `${appBaseUrl()}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${appBaseUrl()}/settings/billing?checkout=canceled`,
  });
  if (!checkout.url) {
    await trackEvent({
      event: "checkout_failed",
      orgId: org.id,
      userId: auth.id,
      meta: { error: checkout.error },
    });
    return NextResponse.redirect(
      new URL("/settings/billing?error=checkout", appBaseUrl())
    );
  }
  await trackEvent({
    event: "checkout_started",
    orgId: org.id,
    userId: auth.id,
    meta: { plan },
  });
  return NextResponse.redirect(checkout.url);
}
