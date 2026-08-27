import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { assignRecord, isOwnableKind, ownerOf } from "@/lib/ownership";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Say whose a record is, or that it is nobody's.
 *
 * Body: `{ assigneeId: string | null }`. Null unassigns, which is a real
 * answer rather than a failure to answer: work that was on somebody and is now
 * on nobody is a state a team gets into, and the alternative of forcing a name
 * means the leaving person stays on forty records.
 *
 * The capability is `view` plus anything, not an administrative one. Assigning
 * is how a team divides a morning, and requiring an administrator for it would
 * mean the person who just picked something up cannot say so.
 */
export async function POST(
  req: Request,
  { params }: { params: { kind: string; id: string } }
) {
  const ctx = await requireOrgContext({ capability: "view" });
  if (ctx instanceof NextResponse) return ctx;

  if (!isOwnableKind(params.kind)) {
    return NextResponse.json({ error: "That kind of record cannot carry an owner." }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { assigneeId?: string | null };
  const assigneeId = body.assigneeId ?? null;
  if (assigneeId !== null && typeof assigneeId !== "string") {
    return NextResponse.json({ error: "assigneeId must be a user id or null." }, { status: 400 });
  }

  let ok: boolean;
  try {
    ok = await assignRecord(params.kind, params.id, assigneeId, ctx.user.id);
  } catch (e) {
    /*
     * The database refused it. The one refusal a caller can cause is naming
     * somebody who is not in this organization, and that is a 400 with the
     * reason rather than a 500: the request was understood and was wrong.
     */
    const message = (e as Error).message ?? "";
    if (message.includes("must be a member")) {
      return NextResponse.json(
        { error: "That person is not in this organization." },
        { status: 400 }
      );
    }
    throw e;
  }

  if (!ok) {
    // 404 rather than 403: a record in another organization must not be
    // distinguishable from one that does not exist.
    return NextResponse.json({ error: "No such record." }, { status: 404 });
  }

  const owner = assigneeId ? await ownerOf(params.kind, params.id) : null;
  await logAgent({
    agent: "assignment",
    action: assigneeId ? "assign" : "unassign",
    status: "ok",
    level: "info",
    // The opportunity link where there is one, so the record's own activity
    // timeline carries the handover rather than only the account-wide log.
    opportunityId: params.kind === "opportunity" ? params.id : null,
    subcontractorId: params.kind === "subcontractor" ? params.id : null,
    message: assigneeId
      ? `${params.kind} assigned to ${owner?.name ?? "a teammate"}`
      : `${params.kind} unassigned`,
    input: { kind: params.kind, recordId: params.id, assigneeId, by: ctx.user.id },
  }).catch(() => {
    // The assignment happened. A missing log line is worth less than a 500
    // that makes the caller retry a write that already succeeded.
  });

  return NextResponse.json({ ok: true, owner });
}
