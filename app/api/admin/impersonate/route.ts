import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { queryOne } from "@/lib/db";
import {
  SESSION_COOKIE,
  createImpersonationSession,
  endImpersonation,
  setSessionCookie,
  clearSessionCookie,
  IMPERSONATION_TTL_MINUTES,
} from "@/lib/auth";
import { requirePlatformAdmin, isPlatformAdmin } from "@/lib/platform-admin";
import { recordAdminAction } from "@/lib/admin/audit";
import { adminAccount } from "@/lib/admin/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Start a support session as a customer's owner account.
 *
 * The admin's own session is left intact and its id is stored on the new
 * session, so ending the support session puts them straight back where they
 * were instead of at the login screen.
 */
export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => ({}))) as { orgId?: string };
  const orgId = String(body.orgId ?? "");
  if (!orgId) return NextResponse.json({ error: "Which account?" }, { status: 400 });

  const org = await adminAccount(orgId);
  if (!org) return NextResponse.json({ error: "That account no longer exists." }, { status: 404 });
  if (!org.owner_user_id || !org.owner_email) {
    return NextResponse.json(
      { error: "That account has no owner to sign in as." },
      { status: 400 }
    );
  }
  if (org.owner_user_id === auth.id) {
    return NextResponse.json({ error: "That is already your account." }, { status: 400 });
  }
  // Refuse to borrow another administrator's identity. Support is for looking
  // at a customer's account, and one admin acting as another would make the
  // audit trail describe the wrong person.
  if (isPlatformAdmin(org.owner_email)) {
    return NextResponse.json(
      { error: "That account belongs to another administrator." },
      { status: 400 }
    );
  }

  const adminToken = cookies().get(SESSION_COOKIE)?.value ?? null;
  const token = await createImpersonationSession({
    targetUserId: org.owner_user_id,
    adminUserId: auth.id,
    adminEmail: auth.email,
    // An env-operator token is self-signed rather than a session row, so there
    // is nothing to restore afterwards; storing it would create a dangling id.
    adminSessionId: adminToken && !adminToken.startsWith("env-operator.") ? adminToken : null,
  });
  await setSessionCookie(token);

  await recordAdminAction({
    adminEmail: auth.email,
    action: "impersonation_started",
    orgId: org.id,
    orgName: org.name,
    userId: org.owner_user_id,
    detail: { owner_email: org.owner_email, minutes: IMPERSONATION_TTL_MINUTES },
  });

  return NextResponse.json({ ok: true, redirect: "/today" });
}

/**
 * End a support session.
 *
 * Deliberately does NOT use requirePlatformAdmin: that guard refuses support
 * sessions, which is exactly what the caller is in. Authority comes from
 * holding the impersonation token itself, and the token is only ever issued to
 * an admin who passed the guard.
 */
export async function DELETE() {
  const token = cookies().get(SESSION_COOKIE)?.value;

  const marker = token
    ? await queryOne<{
        impersonator_email: string | null;
        user_id: string;
      }>(
        `select impersonator_email, user_id from sessions
          where id = $1 and impersonator_email is not null`,
        [token]
      ).catch(() => null)
    : null;

  const restored = await endImpersonation(token);

  if (marker?.impersonator_email) {
    await recordAdminAction({
      adminEmail: marker.impersonator_email,
      action: "impersonation_ended",
      userId: marker.user_id,
    });
  }

  if (restored) {
    await setSessionCookie(restored);
    return NextResponse.json({ ok: true, redirect: "/admin/accounts" });
  }
  // No session to go back to (it expired, or this was never an impersonation).
  // Signing out is the honest outcome; leaving the cookie would keep the
  // browser signed in as the customer.
  await clearSessionCookie();
  return NextResponse.json({ ok: true, redirect: "/login" });
}
