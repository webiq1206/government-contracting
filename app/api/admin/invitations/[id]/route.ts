import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { resendInvitation, revokeInvitation } from "@/lib/admin/invitations";
import type { AdminActionResult } from "@/lib/admin/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Withdraw an invitation, or send it again with a fresh link. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => ({}))) as { action?: string };

  let result: AdminActionResult;
  switch (body.action) {
    case "revoke":
      result = await revokeInvitation({ id: params.id, adminEmail: auth.email });
      break;
    case "resend":
      result = await resendInvitation({ id: params.id, adminEmail: auth.email });
      break;
    default:
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, message: result.message });
}
