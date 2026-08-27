import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { dismissMessage, matchMessage, needsMatching } from "@/lib/needs-matching";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What is still waiting to be placed. */
export async function GET() {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;
  const messages = await needsMatching(ctx.orgId);
  return NextResponse.json({
    messages: messages.map((m) => ({
      ...m,
      receivedAt: m.receivedAt.toISOString(),
    })),
  });
}

/**
 * Place a message, or say it is not ours.
 *
 * POST /api/inbox/needs-matching { id, action: "match" | "dismiss", ... }
 *
 * Takes `outreach`: placing a reply against an opportunity records a
 * communication, which changes what the coverage and the conversation say. It
 * is the same class of act as sending one.
 */
export async function POST(req: Request) {
  const ctx = await requireOrgContext({ capability: "outreach" });
  if (ctx instanceof NextResponse) return ctx;

  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    action?: string;
    opportunityId?: string;
    subcontractorId?: string;
    reason?: string;
  };
  const id = (body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "Which message?" }, { status: 400 });

  if (body.action === "match") {
    const opportunityId = (body.opportunityId ?? "").trim();
    if (!opportunityId) {
      return NextResponse.json(
        { error: "Say which opportunity this reply is about." },
        { status: 400 }
      );
    }
    const placed = await matchMessage(
      id,
      ctx.orgId,
      opportunityId,
      ctx.user.email,
      body.subcontractorId?.trim() || null
    );
    // One 404 whether the message, the opportunity or the subcontractor was
    // the thing that did not belong to this account.
    if (!placed) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true, communicationId: placed.communicationId });
  }

  if (body.action === "dismiss") {
    const reason = (body.reason ?? "").trim();
    if (!reason) {
      return NextResponse.json(
        {
          error:
            "Give a reason. Dismissing with no reason cannot be told apart from a message nobody read.",
        },
        { status: 400 }
      );
    }
    const done = await dismissMessage(id, ctx.orgId, reason, ctx.user.email);
    if (!done) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
