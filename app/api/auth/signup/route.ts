import { NextResponse } from "next/server";
import { signupAccount } from "@/lib/auth-signup";
import { setSessionCookie } from "@/lib/auth";
import { trackEvent } from "@/lib/analytics";
import { billingConfigured } from "@/lib/billing/catalog";

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

  // Signup no longer touches Stripe. The 7-day trial is cardless and granted
  // by createOrganizationForUser, so the first thing a new customer sees is
  // the product rather than a payment form. Billing being unconfigured is
  // therefore no longer a reason to refuse a signup: it only prevents the
  // upgrade, which is checked at /api/billing/checkout when they choose a
  // plan. It is still worth a loud log, because a trial nobody can convert is
  // a silent revenue outage.
  const configured = billingConfigured();
  if (!configured.ok) {
    console.error(
      "[billing] TRIALS CANNOT CONVERT, missing:",
      configured.missing.join(", ")
    );
  }

  await trackEvent({
    event: "trial_started",
    orgId: result.orgId,
    userId: result.user.id,
    path: "/signup",
    meta: { plan: body.plan === "founding" ? "founding" : "standard" },
  });

  return NextResponse.json({ redirect: "/today" });
}
