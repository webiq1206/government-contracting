import { NextResponse } from "next/server";
import { currentUser, type SessionUser } from "./auth";
import { accessLevel, accessBlockedReason, entitlementOf } from "./billing/entitlements";
import { can, permissionMessage, roleLabel, type Capability } from "./domain/roles";

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

/**
 * Require a subscriber who is also allowed to do this particular thing.
 *
 * Until this existed, `organization_members.role` was stored, displayed, and
 * consulted by nothing: every signed-in member of an organization had
 * identical write access. A "read-only user" could change final pricing,
 * publish account-wide automation rules, delete subcontractors and submit a
 * federal bid. The role appeared in the interface as a promise the system did
 * not keep.
 *
 * Layered rather than replacing requireSubscriber: authentication, then
 * access, then permission, and each answer is the one every other surface
 * gets. A 403 here means "signed in, paid up, not allowed", which is a
 * different conversation from a 401 or a 402, and the body says which role
 * could do it so the reply is "ask Dana" rather than "the app is broken".
 */
export async function requireCapability(
  capability: Capability
): Promise<SessionUser | NextResponse> {
  const auth = await requireSubscriber();
  if (auth instanceof NextResponse) return auth;
  if (!can(auth.orgRole, capability)) {
    return NextResponse.json(
      {
        error: permissionMessage(auth.orgRole, capability),
        requiredCapability: capability,
        yourRole: roleLabel(auth.orgRole),
      },
      { status: 403 }
    );
  }
  return auth;
}
