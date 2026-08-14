import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { createInvitation } from "@/lib/admin/invitations";
import type { ConcessionKind } from "@/lib/billing/concessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: ConcessionKind[] = ["none", "percent", "free_months", "free_account"];

/**
 * Issue an invitation.
 *
 * `requirePlatformAdmin` answers 404 to everyone else and refuses support
 * sessions outright, so an admin signed in as a customer cannot mint an
 * invitation carrying a discount under that customer's nose.
 */
export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    plan?: string;
    interval?: string;
    kind?: string;
    percent?: number;
    months?: number;
    note?: string;
  };

  const kind = KINDS.includes(body.kind as ConcessionKind)
    ? (body.kind as ConcessionKind)
    : "none";

  const result = await createInvitation({
    email: String(body.email ?? ""),
    plan: body.plan === "founding" ? "founding" : "standard",
    interval: body.interval === "year" ? "year" : "month",
    concession: {
      kind,
      // Only read the numbers the chosen kind actually uses. Carrying a stale
      // percentage into a free-months grant would fail the table's shape
      // check with a constraint error instead of a sentence.
      percent: kind === "percent" ? Number(body.percent) : null,
      months:
        kind === "free_months"
          ? Number(body.months)
          : kind === "percent" && body.months
            ? Number(body.months)
            : null,
    },
    note: body.note ?? null,
    adminEmail: auth.email,
    adminUserId: auth.id,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, message: result.message });
}
