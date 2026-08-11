import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
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
