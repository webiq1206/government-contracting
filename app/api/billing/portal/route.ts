import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { can } from "@/lib/domain/roles";
import { appBaseUrl, createBillingPortalSession } from "@/lib/billing/stripe";
import { getOrganization } from "@/lib/organizations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
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
  // The Stripe portal can cancel the subscription and change the card on file.
  // An admin in a support session must not be able to do that on a customer's
  // behalf, and the customer would have no record of who did.
  if (auth.impersonatedBy) {
    return NextResponse.redirect(
      new URL("/settings/billing?error=support_session", appBaseUrl())
    );
  }
  const org = await getOrganization(auth.organizationId);
  if (!org?.stripe_customer_id) {
    return NextResponse.redirect(
      new URL("/settings/billing?error=no_customer", appBaseUrl())
    );
  }
  const portal = await createBillingPortalSession({
    customerId: org.stripe_customer_id,
    returnUrl: `${appBaseUrl()}/settings/billing`,
  });
  if (!portal.url) {
    return NextResponse.redirect(
      new URL("/settings/billing?error=portal", appBaseUrl())
    );
  }
  return NextResponse.redirect(portal.url);
}
