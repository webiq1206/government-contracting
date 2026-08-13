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
import { billingConfigured, type BillingInterval } from "@/lib/billing/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Per-address signup throttle. A real customer signs up once, maybe twice
 * after a typo; a script creating accounts (each of which mints a Stripe
 * customer and a checkout session) does it hundreds of times. Same in-memory
 * limiter as the vendor portal, same stated tradeoffs.
 */
const SIGNUP_RULE = { limit: 5, windowMs: 60 * 60 * 1000 };

export async function POST(req: Request) {
  const { consume, clientIp, tooManyRequests } = await import("@/lib/rate-limit");
  const gate = consume("auth-signup", clientIp(req), SIGNUP_RULE);
  if (!gate.ok) {
    return tooManyRequests(
      "Too many signup attempts from this connection. Wait a few minutes and try again.",
      gate
    );
  }
  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    name?: string;
    companyName?: string;
    plan?: string;
    interval?: string;
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
  const interval: BillingInterval = body.interval === "year" ? "year" : "month";

  // No unpaid path to an active account. This previously activated the
  // organization outright whenever Stripe was unconfigured, which in
  // production handed out full access for free to anyone who signed up.
  const configured = billingConfigured();
  if (!configured.ok) {
    console.error("[billing] signup blocked, missing:", configured.missing.join(", "));
    return NextResponse.json(
      {
        error:
          "Signups are temporarily unavailable while billing is being set up. Please try again shortly.",
      },
      { status: 503 }
    );
  }

  const checkout = await createCheckoutSession({
    orgId: result.orgId,
    customerEmail: result.user.email,
    plan,
    interval,
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
