import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { callCardHistory, callQueue } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Load everything the Call Workspace needs for one card in a single request:
 * the card + all sub/opp/attachment context (via callQueue projection) plus the
 * per-pair communications + quotes history.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const cards = await callQueue();
  const card = cards.find((c) => c.id === params.id);
  if (!card) {
    // Fall back to a broader query if the card is not in the pending queue
    // (e.g. a completed card the operator is re-opening).
    return NextResponse.json({ error: "Call card not found in pending queue." }, { status: 404 });
  }

  const { communications, quotes } = await callCardHistory(
    card.subcontractor_id,
    card.opportunity_id
  );

  return NextResponse.json({ card, communications, quotes });
}
