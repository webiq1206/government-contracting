import { NextResponse } from "next/server";
import { requireOrgContext, findOrgRecord, notFoundResponse } from "@/lib/org-guard";
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
  const ctx = await requireOrgContext({ capability: "outreach" });
  if (ctx instanceof NextResponse) return ctx;

  // skipCallCard works by bare id; prove the card is ours before handing over.
  const card = await findOrgRecord("call_cards", params.id, ctx.orgId, "id");
  if (!card) return notFoundResponse();

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
