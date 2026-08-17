import { NextResponse } from "next/server";
import { requireOrgContext, findOrgRecord, notFoundResponse } from "@/lib/org-guard";
import { callCardById, callCardHistory } from "@/lib/data";
import { getProfileJson } from "@/lib/ai/companyProfile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Load everything the Call Workspace needs for one card in a single request:
 * the card + all sub/opp/attachment context plus the per-pair communications
 * and quotes history. Fetches exactly one card (any status, so completed
 * cards can be reopened) instead of scanning the whole pending queue.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;

  // callCardById assembles context by bare id; prove ownership first.
  const owned = await findOrgRecord("call_cards", params.id, ctx.orgId, "id");
  if (!owned) return notFoundResponse();

  const card = await callCardById(params.id);
  if (!card) {
    return NextResponse.json({ error: "Call card not found." }, { status: 404 });
  }

  const [{ communications, quotes }, profile] = await Promise.all([
    callCardHistory(card.subcontractor_id, card.opportunity_id),
    // Who the operator says they are on the call. Same fields the outreach
    // emails sign off with, so the sub hears the name they already read.
    getProfileJson().catch(() => null),
  ]);

  const caller = {
    name: profile?.outreach_display_name?.trim() || profile?.owner_name?.trim() || null,
    company: profile?.dba?.trim() || profile?.legal_name?.trim() || null,
  };

  return NextResponse.json({ card, communications, quotes, caller });
}
