import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { getFoundingPromo } from "@/lib/billing/promo";
import {
  appBaseUrl,
  createCheckoutSession,
  stripeEnabled,
} from "@/lib/billing/stripe";
import { getOrganization } from "@/lib/organizations";
import { billingConfigured, type BillingInterval } from "@/lib/billing/catalog";
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
  // Eligibility is decided here, on the server, from the stored promo window.
  // A closed window means the founding rate cannot be claimed by anyone who
  // simply passes ?plan=founding.
  if (plan === "founding" && !promo.active) plan = "standard";
  const interval: BillingInterval =
    url.searchParams.get("interval") === "year" ? "year" : "month";

  const org = await getOrganization(auth.organizationId);
  if (!org) {
    return NextResponse.redirect(new URL("/signup", appBaseUrl()));
  }

  // Billing must be fully wired before anyone can subscribe. The previous
  // version granted active access with no payment whenever Stripe was
  // unconfigured, which in production was free access for anyone who reached
  // this URL.
  const configured = billingConfigured();
  if (!configured.ok) {
    console.error("[billing] checkout blocked, missing:", configured.missing.join(", "));
    await trackEvent({
      event: "checkout_blocked",
      orgId: org.id,
      userId: auth.id,
      meta: { missing: configured.missing },
    });
    return NextResponse.redirect(
      new URL("/settings/billing?error=unavailable", appBaseUrl())
    );
  }

  const checkout = await createCheckoutSession({
    orgId: org.id,
    customerEmail: auth.email,
    customerId: org.stripe_customer_id,
    plan,
    interval,
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
    meta: { plan, interval },
  });
  return NextResponse.redirect(checkout.url);
}
