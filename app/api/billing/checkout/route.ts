import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { can } from "@/lib/domain/roles";
import { getFoundingPromo } from "@/lib/billing/promo";
import {
  appBaseUrl,
  createCheckoutSession,
  stripeEnabled,
} from "@/lib/billing/stripe";
import { getOrganization } from "@/lib/organizations";
import { billingConfigured, type BillingInterval } from "@/lib/billing/catalog";
import { invitedTermsForOrg } from "@/lib/admin/invitations";
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
  /*
   * Permission, checked here rather than through requireCapability: that one
   * layers on requireSubscriber, which answers 402 for a lapsed account, and
   * these two routes are exactly the ones a lapsed account must still reach in
   * order to stop being lapsed. So the billing gate stays off and the
   * permission gate goes on. A redirect rather than a JSON 403 because these
   * are navigations, not fetches: the browser is following a link, and a raw
   * JSON body in the address bar is not an answer to anybody.
   */
  if (!can(auth.orgRole, "manage_billing")) {
    return NextResponse.redirect(
      new URL("/settings/billing?error=not_permitted", appBaseUrl())
    );
  }
  // Checkout takes a payment method. Not something to start on someone's
  // behalf from a support session.
  if (auth.impersonatedBy) {
    return NextResponse.redirect(
      new URL("/settings/billing?error=support_session", appBaseUrl())
    );
  }

  const url = new URL(req.url);

  const org = await getOrganization(auth.organizationId);
  if (!org) {
    return NextResponse.redirect(new URL("/signup", appBaseUrl()));
  }

  // A comped account is free, permanently and by our own decision. There is
  // nothing here for it to buy, and letting it reach Stripe would mean
  // charging somebody we told would never be charged. The billing page hides
  // the plan picker for these accounts, but that is presentation: this is the
  // guard.
  if (org.billing_exempt) {
    return NextResponse.redirect(
      new URL("/settings/billing?error=account_is_free", appBaseUrl())
    );
  }

  // An account that came in through an invitation and has not subscribed yet
  // is bound to the terms it was invited on. Reading the plan from the query
  // string here would let an invitee take a discount that was priced against
  // one plan onto another, and running the public founding window against
  // them would downgrade a founding invitation accepted after that window
  // closed. Neither has anything to do with what was agreed with them.
  const invited = org.stripe_subscription_id
    ? null
    : await invitedTermsForOrg(org.id).catch(() => null);

  let plan: "founding" | "standard";
  let interval: BillingInterval;
  if (invited) {
    plan = invited.plan;
    interval = invited.interval;
  } else {
    const promo = await getFoundingPromo({ startIfMissing: false });
    plan = url.searchParams.get("plan") === "founding" ? "founding" : "standard";
    // Eligibility is decided here, on the server, from the stored promo window.
    // A closed window means the founding rate cannot be claimed by anyone who
    // simply passes ?plan=founding.
    if (plan === "founding" && !promo.active) plan = "standard";
    interval = url.searchParams.get("interval") === "year" ? "year" : "month";
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
    // A discount we promised this account before they had a subscription to
    // put it on. This is the moment it exists, so this is where it goes on.
    couponId: org.pending_coupon_id,
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
