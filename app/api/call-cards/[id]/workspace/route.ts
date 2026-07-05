import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { callCardById, callCardHistory } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Load everything the Call Workspace needs for one card in a single request:
 * the card + all sub/opp/attachment context plus the per-pair communications
 * and quotes history. Fetches exactly one card (any status, so completed
 * cards can be reopened) instead of scanning the whole pending queue.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const card = await callCardById(params.id);
  if (!card) {
    return NextResponse.json({ error: "Call card not found." }, { status: 404 });
  }

  const { communications, quotes } = await callCardHistory(
    card.subcontractor_id,
    card.opportunity_id
  );

  return NextResponse.json({ card, communications, quotes });
}
