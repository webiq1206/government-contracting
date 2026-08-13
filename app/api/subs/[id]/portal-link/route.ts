import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { loadSubForOperator } from "@/lib/sub-access";
import { subPortalUrl, portalLinkExpiry, PORTAL_TTL_SECONDS } from "@/lib/domain/sub-portal-link";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mint the link a subcontractor uses to send us their paperwork.
 *
 * A POST rather than a GET because it creates a credential. Tokens are
 * stateless and expiring, so this issues a fresh one every time rather than
 * looking an old one up; if a link goes astray, the answer is to wait it out
 * or change AUTH_SECRET, not to hunt for a row to delete.
 *
 * Logged with the operator's name. Someone handing out signing links should
 * leave a trace of having done it.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;
  const { user: auth } = ctx;

  const sub = await loadSubForOperator(params.id);
  if (!sub) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const url = subPortalUrl(sub.id);
  const expiresAt = portalLinkExpiry();

  await logAgent({
    agent: "operator",
    action: "portal-link-issued",
    subcontractorId: sub.id,
    level: "info",
    // The URL itself is a credential and stays out of the log line.
    message: `Operator ${auth.email} issued a paperwork link for ${sub.company_name}, valid until ${expiresAt.toISOString()}.`,
  });

  return NextResponse.json({
    ok: true,
    url,
    expiresAt: expiresAt.toISOString(),
    ttlDays: Math.round(PORTAL_TTL_SECONDS / 86_400),
  });
}
