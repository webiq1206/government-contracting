import { NextResponse } from "next/server";
import { requireOrgContext, findOrgRecord, notFoundResponse } from "@/lib/org-guard";
import { skipCallCard } from "@/lib/skip-call";
import { parseScope, parseSkipReason } from "@/lib/domain/suppression";

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

  // skipCallCard works by bare id; prove the card is ours before handing over.
  const card = await findOrgRecord("call_cards", params.id, ctx.orgId, "id");
  if (!card) return notFoundResponse();

  const body = (await req.json().catch(() => ({}))) as {
    reason?: string;
    note?: string;
    scope?: string;
    dialed?: boolean;
    undo?: boolean;
  };
  const structured = parseSkipReason(body.reason);

  try {
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
