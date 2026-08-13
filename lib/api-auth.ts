import { NextResponse } from "next/server";
import { currentUser, type SessionUser } from "./auth";
import { accessLevel, accessBlockedReason, entitlementOf } from "./billing/entitlements";

/**
 * Guard for API route handlers. Returns the user, or a 401 response to return
 * early. Usage:
 *   const auth = await requireUser();
 *   if (auth instanceof NextResponse) return auth;
 *   // auth is SessionUser
 */
export async function requireUser(): Promise<SessionUser | NextResponse> {
  const user = await currentUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return user;
}

/**
 * Require a signed-in user with an organization and an active subscription.
 * Billing webhook + checkout routes should use requireUser() only.
 */
export async function requireSubscriber(): Promise<SessionUser | NextResponse> {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) {
    return NextResponse.json({ error: "No organization on this account." }, { status: 403 });
  }
  // Date-aware and exemption-aware: the same single answer the dashboard shell
  // and the org guard use, so a comped account cannot be refused here while
  // being allowed there.
  if (accessLevel(entitlementOf(auth)) === "none") {
    return NextResponse.json(
      { error: accessBlockedReason(entitlementOf(auth)), upgradeUrl: "/settings/billing" },
      { status: 402 }
    );
  }
  return auth;
}
