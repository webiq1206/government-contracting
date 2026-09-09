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
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;

  // callCardById assembles context by bare id; prove ownership first.
  const owned = await findOrgRecord("call_cards", params.id, ctx.orgId, "id");
  if (!owned) return notFoundResponse();

  const card = await callCardById(params.id);
  if (!card) {
    return NextResponse.json({ error: "Call card not found." }, { status: 404 });
  }

  const [historyResult, profileResult] = await Promise.allSettled([
    callCardHistory(card.subcontractor_id, card.opportunity_id),
    // Who the operator says they are on the call. Same fields the outreach
    // emails sign off with, so the sub hears the name they already read.
    getProfileJson(),
  ]);

  if (historyResult.status === "rejected") {
    return NextResponse.json(
      {
        error:
          "The call card loaded, but its communication and quote history could not be verified. Retry before calling so you do not miss an earlier answer or price.",
      },
      { status: 503 }
    );
  }
  if (profileResult.status === "rejected") {
    return NextResponse.json(
      {
        error:
          "The call card loaded, but caller identity could not be verified. Retry before calling so you introduce the correct company and person.",
      },
      { status: 503 }
    );
  }

  const { communications, quotes } = historyResult.value;
  const profile = profileResult.value;
  if (!profile) {
    return NextResponse.json(
      {
        error:
          "Caller identity is not configured. Complete the Company Profile before starting this call.",
      },
      { status: 409 }
    );
  }

  const caller = {
    name: profile?.outreach_display_name?.trim() || profile?.owner_name?.trim() || null,
    company: profile?.dba?.trim() || profile?.legal_name?.trim() || null,
  };
  if (!caller.name && !caller.company) {
    return NextResponse.json(
      {
        error:
          "Caller identity is incomplete. Add a company or caller name in the Company Profile before starting this call.",
      },
      { status: 409 }
    );
  }

  return NextResponse.json({ card, communications, quotes, caller });
}
