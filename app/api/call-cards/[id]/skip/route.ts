import { NextResponse } from "next/server";
import { requireOrgContext, findOrgRecord, notFoundResponse } from "@/lib/org-guard";
import { skipCallCard } from "@/lib/skip-call";
import { parseScope, parseSkipReason } from "@/lib/domain/suppression";
import { SuppressionRejected } from "@/lib/suppressions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Skip a queued call without opening the workspace.
 *
 * Body: { reason?, note?, scope?, dialed?, undo? }.
 *
 * `reason` is one of the structured skip reasons so these can be counted:
 * "they already replied by email" turning up on half a call queue is a
 * scheduling defect worth fixing, and the same fact spread across forty
 * differently worded notes is invisible. Free text is still accepted, and
 * lands in the note rather than being lost.
 *
 * `scope` decides how far the decision reaches, and defaults to `once`, which
 * writes no standing rule at all. Records status=skipped, a Sub Detail note,
 * and an audit entry, and never marks the subcontractor declined,
 * unresponsive or not interested: choosing not to ring somebody says nothing
 * about them.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const ctx = await requireOrgContext({ capability: "outreach" });
  if (ctx instanceof NextResponse) return ctx;

  const body = (await req.json().catch(() => ({}))) as {
    reason?: string;
    note?: string;
    scope?: string;
    dialed?: boolean;
    undo?: boolean;
  };
  const structured = parseSkipReason(body.reason);

  try {
    // An inexpensive not-found decision before the helper locks and rechecks
    // the same tenant boundary inside its transaction.
    const card = await findOrgRecord("call_cards", params.id, ctx.orgId, "id");
    if (!card) return notFoundResponse();

    const result = await skipCallCard(params.id, {
      // An unrecognised reason is kept as the note rather than dropped: the
      // operator wrote a sentence and it belongs somewhere.
      reason: structured ? undefined : body.reason,
      skipReason: structured,
      note: body.note ?? (structured ? undefined : body.reason) ?? null,
      scope: parseScope(body.scope),
      dialed: body.dialed === true,
      orgId: ctx.orgId,
      actor: ctx.user.email,
      undo: body.undo === true,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = (err as Error).message;
    if (message === "Call card not found.") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message.includes("cannot be skipped") || message.includes("Only a skipped")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    if (err instanceof SuppressionRejected) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error("[call-skip] transaction failed:", err);
    return NextResponse.json(
      {
        error:
          "The call decision could not be saved, so no change was completed. Reload the queue and try again. If it continues, contact support before calling this subcontractor.",
      },
      { status: 503 }
    );
  }
}
