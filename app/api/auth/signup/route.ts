import { NextResponse } from "next/server";
import { signupAccount } from "@/lib/auth-signup";
import { setSessionCookie } from "@/lib/auth";
import { getFoundingPromo } from "@/lib/billing/promo";
import {
  appBaseUrl,
  createCheckoutSession,
  stripeEnabled,
} from "@/lib/billing/stripe";
import { trackEvent } from "@/lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    name?: string;
    companyName?: string;
    plan?: string;
  };

  const result = await signupAccount({
    email: body.email ?? "",
    password: body.password ?? "",
    name: body.name ?? "",
    companyName: body.companyName ?? "",
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  await setSessionCookie(result.token);

  const promo = await getFoundingPromo({ startIfMissing: false });
  let plan: "founding" | "standard" =
    body.plan === "founding" ? "founding" : "standard";
  if (plan === "founding" && !promo.active) plan = "standard";

  if (!stripeEnabled()) {
    // Local/dev without Stripe: activate org so the product can be exercised.
    const { updateOrganizationBilling } = await import("@/lib/organizations");
    const { amountCentsForPlan } = await import("@/lib/billing/stripe");
    await updateOrganizationBilling(result.orgId, {
      plan_key: plan,
      plan_amount_cents: amountCentsForPlan(plan),
      subscription_status: "active",
      price_locked: plan === "founding",
    });
    await trackEvent({
      event: "subscription_completed",
      orgId: result.orgId,
      userId: result.user.id,
      path: "/signup",
      meta: { plan, mode: "dev_bypass" },
    });
    return NextResponse.json({ redirect: "/today" });
  }

  const checkout = await createCheckoutSession({
    orgId: result.orgId,
    customerEmail: result.user.email,
    plan,
    successUrl: `${appBaseUrl()}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${appBaseUrl()}/signup?plan=${plan}&checkout=canceled`,
  });

  if (!checkout.url) {
    return NextResponse.json(
      { error: checkout.error || "Checkout unavailable." },
      { status: 502 }
    );
  }

  await trackEvent({
    event: "checkout_started",
    orgId: result.orgId,
    userId: result.user.id,
    path: "/signup",
    meta: { plan },
  });

  return NextResponse.json({ checkoutUrl: checkout.url });
}
