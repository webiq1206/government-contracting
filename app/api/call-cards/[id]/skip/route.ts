import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { skipCallCard } from "@/lib/skip-call";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Skip a queued call without opening the workspace.
 * Body (optional): { reason?: string, undo?: boolean }
 *
 * Records status=skipped, a Sub Detail note, and an agent_logs audit entry.
 * Undo restores the card to pending.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => ({}))) as {
    reason?: string;
    undo?: boolean;
  };

  try {
    const result = await skipCallCard(params.id, {
      reason: body.reason,
      undo: body.undo === true,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = (err as Error).message;
    const status =
      message === "Call card not found."
        ? 404
        : message.includes("cannot be skipped") ||
            message.includes("Only a skipped")
          ? 400
          : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
