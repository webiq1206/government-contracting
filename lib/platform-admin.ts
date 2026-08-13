/**
 * Platform administrators: the people who run this SaaS, as distinct from the
 * owner of any one customer organization.
 *
 * Membership is an environment allowlist rather than a database role on
 * purpose. Cross-tenant billing visibility is the most sensitive read in the
 * application, and an env var cannot be granted by anything that happens
 * inside the product: no signup flow, no invite, no compromised org owner.
 */
import { NextResponse } from "next/server";
import { currentUser, type SessionUser } from "./auth";

/** Lowercased set of emails allowed to see across tenants. */
export function platformAdminEmails(): Set<string> {
  const raw = process.env.PLATFORM_ADMIN_EMAILS ?? "";
  const list = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  // The env operator is the deployment's own account and is always allowed,
  // otherwise a fresh install would have no way in. Read from process.env
  // rather than config: config captures this at module load, so a value
  // hydrated later would be missed here.
  const operator = process.env.OPERATOR_EMAIL?.trim().toLowerCase();
  if (operator) list.push(operator);
  return new Set(list);
}

export function isPlatformAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return platformAdminEmails().has(email.trim().toLowerCase());
}

/**
 * Guard for platform-admin routes and pages.
 *
 * Returns a 404 rather than a 403 for a signed-in non-admin: telling someone
 * an admin area exists is an invitation to go looking for a gap in it.
 */
export async function requirePlatformAdmin(): Promise<SessionUser | NextResponse> {
  const user = await currentUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // A support session is never an admin session, even when the admin who
  // opened it is on the allowlist. This is what stops an impersonated session
  // from reaching the admin area, and it is also what makes nested
  // impersonation impossible: starting one requires this guard to pass.
  if (user.impersonatedBy) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!isPlatformAdmin(user.email)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return user;
}
