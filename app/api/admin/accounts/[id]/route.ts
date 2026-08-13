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
