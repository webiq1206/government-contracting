import { NextResponse } from "next/server";
import { requireUser, requireCapability } from "@/lib/api-auth";
import { resolveTenantOrgId } from "@/lib/tenant";
import { gmail } from "@/lib/integrations/gmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Forget this tenant's Gmail connection.
 *
 * Only the stored token is dropped. The user's mailbox and its contents are
 * untouched, and the grant itself can still be revoked by them at Google. The
 * org comes from the session, never the request body, so one tenant cannot
 * disconnect another's inbox.
 */
export async function POST() {
  const auth = await requireCapability("manage_integrations");
  if (auth instanceof NextResponse) return auth;
  const orgId = await resolveTenantOrgId();
  await gmail.disconnect(orgId);
  return NextResponse.json({ ok: true });
}
