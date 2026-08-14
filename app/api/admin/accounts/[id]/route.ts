import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import {
  cancelSubscription,
  deleteAccount,
  extendTrial,
  restartTrial,
  setBillingExempt,
  setSuspended,
  type AdminActionResult,
} from "@/lib/admin/accounts";
import {
  convertToFree,
  grantConcession,
  removeConcession,
} from "@/lib/admin/concessions";
import { grantKeyToAccount, revokeKeyFromAccount } from "@/lib/admin/platform-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Administrative actions on one customer account.
 *
 * `requirePlatformAdmin` answers 404 rather than 403 for anyone else, and it
 * refuses support sessions outright — so an admin cannot reach these while
 * signed in as somebody, which is what keeps an impersonated session from
 * being used to suspend or delete accounts.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    reason?: string;
    days?: number;
    percent?: number;
    months?: number;
    envKey?: string;
    expiresAt?: string | null;
  };
  const orgId = params.id;
  const adminEmail = auth.email;
  const reason = String(body.reason ?? "");

  let result: AdminActionResult;
  switch (body.action) {
    case "comp":
      result = await setBillingExempt({ orgId, exempt: true, reason, adminEmail });
      break;
    case "uncomp":
      result = await setBillingExempt({ orgId, exempt: false, reason, adminEmail });
      break;
    case "extend_trial":
      result = await extendTrial({ orgId, days: Number(body.days ?? 0), adminEmail });
      break;
    case "restart_trial":
      result = await restartTrial({ orgId, adminEmail });
      break;
    case "cancel":
      result = await cancelSubscription({ orgId, adminEmail });
      break;
    case "suspend":
      result = await setSuspended({ orgId, suspended: true, reason, adminEmail });
      break;
    case "reactivate":
      result = await setSuspended({ orgId, suspended: false, reason, adminEmail });
      break;
    case "discount":
      result = await grantConcession({
        orgId,
        concession: {
          kind: "percent",
          percent: Number(body.percent),
          // Optional: no month count means it runs for the life of the
          // subscription, which is what an open-ended negotiated rate is.
          months: body.months ? Number(body.months) : null,
        },
        reason,
        adminEmail,
      });
      break;
    case "free_months":
      result = await grantConcession({
        orgId,
        concession: { kind: "free_months", months: Number(body.months) },
        reason,
        adminEmail,
      });
      break;
    case "remove_discount":
      result = await removeConcession({ orgId, reason, adminEmail });
      break;
    case "make_free":
      result = await convertToFree({ orgId, reason, adminEmail });
      break;
    case "grant_key":
      result = await grantKeyToAccount({
        orgId,
        key: String(body.envKey ?? ""),
        note: reason,
        // An empty string from an untouched date input means no expiry, which
        // is a real choice here and not a missing value.
        expiresAt: body.expiresAt ? String(body.expiresAt) : null,
        adminEmail,
        adminUserId: auth.id,
      });
      break;
    case "revoke_key":
      result = await revokeKeyFromAccount({
        orgId,
        key: String(body.envKey ?? ""),
        adminEmail,
      });
      break;
    default:
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, message: result.message });
}

/** Delete an account and everything in it. Requires the exact name typed back. */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => ({}))) as { confirmName?: string };
  const result = await deleteAccount({
    orgId: params.id,
    confirmName: String(body.confirmName ?? ""),
    adminEmail: auth.email,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, message: result.message });
}
