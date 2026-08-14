import { NextResponse } from "next/server";
import { redeemInvitation } from "@/lib/admin/invitations";
import { setSessionCookie } from "@/lib/auth";
import { trackEvent } from "@/lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Turn an invitation into an account.
 *
 * Public, because the person using it does not have a login yet. That makes it
 * the one route in this feature not behind the admin guard, so it is throttled
 * like signup: an unauthenticated endpoint that creates users and redeems
 * Stripe coupons is worth guessing at.
 */
const ACCEPT_RULE = { limit: 10, windowMs: 60 * 60 * 1000 };

export async function POST(req: Request) {
  const { consume, clientIp, tooManyRequests } = await import("@/lib/rate-limit");
  const gate = consume("invitation-accept", clientIp(req), ACCEPT_RULE);
  if (!gate.ok) {
    return tooManyRequests(
      "Too many attempts from this connection. Wait a few minutes and try again.",
      gate
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    token?: string;
    name?: string;
    companyName?: string;
    password?: string;
  };

  const result = await redeemInvitation({
    token: String(body.token ?? ""),
    name: String(body.name ?? ""),
    companyName: String(body.companyName ?? ""),
    password: String(body.password ?? ""),
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // Signed in immediately, the same as ordinary signup. Making somebody who
  // just set a password type it again would be theatre.
  setSessionCookie(result.sessionToken);
  await trackEvent({
    event: "invitation_accepted",
    orgId: result.orgId,
    userId: result.userId,
    path: "/invite",
  });

  return NextResponse.json({ redirect: "/today" });
}
