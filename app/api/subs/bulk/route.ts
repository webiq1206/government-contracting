import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { logAgent } from "@/lib/logger";
import { bulkArchive, bulkTag, bulkVerify, undoBulk } from "@/lib/sub-bulk";
import { BULK_REVERSIBLE, describeOutcome } from "@/lib/domain/sub-bulk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Change several roster records at once, and take the change back.
 *
 * These were left unbuilt on purpose, with a note saying why: they each write
 * to a roster shared across live bids, and a button that changes two hundred
 * rows with no way back is worse than no button. So every write here records
 * exactly which rows it changed and which it left alone with the reason, and
 * returns the batch id that undoes it.
 *
 * Body: `{ action: "verify" | "tag" | "untag" | "archive", ids, tag?, reason? }`
 * or `{ action: "undo", batch_id }`.
 */
export async function POST(req: Request) {
  const ctx = await requireOrgContext({ capability: "manage_subs" });
  if (ctx instanceof NextResponse) return ctx;

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    ids?: unknown;
    tag?: string;
    reason?: string;
    batch_id?: string;
  };

  if (body.action === "undo") {
    const res = await undoBulk({
      orgId: ctx.orgId,
      batchId: String(body.batch_id ?? ""),
      actorId: ctx.user.id,
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    await logAgent({
      agent: "operator",
      action: "sub-bulk-undone",
      level: "info",
      message: `Took back a bulk change. ${res.restored} records went back.`,
    });
    return NextResponse.json({
      ok: true,
      message: `Taken back. ${res.restored} ${res.restored === 1 ? "record" : "records"} went back.`,
    });
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === "string") : [];
  const common = { orgId: ctx.orgId, actorId: ctx.user.id, ids };

  const res =
    body.action === "verify"
      ? await bulkVerify(common)
      : body.action === "tag"
        ? await bulkTag({ ...common, tag: String(body.tag ?? "") })
        : body.action === "untag"
          ? await bulkTag({ ...common, tag: String(body.tag ?? ""), remove: true })
          : body.action === "archive"
            ? await bulkArchive({ ...common, reason: String(body.reason ?? "") })
            : null;

  if (!res) return NextResponse.json({ error: "That is not something to do here." }, { status: 400 });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });

  const message = describeOutcome(res);
  await logAgent({
    agent: "operator",
    action: `sub-bulk-${res.kind}`,
    level: "info",
    // The same sentence the operator saw, so the log and the toast agree.
    message,
  });
  return NextResponse.json({
    ok: true,
    message,
    /*
     * Only offered when there is something to take back. A re-check is not
     * reversible and a batch that changed nothing has nothing to reverse, and
     * in both cases a control that refuses when pressed is worse than no
     * control: the rule lives here rather than being restated in the UI.
     */
    batchId: BULK_REVERSIBLE[res.kind] && res.changed > 0 ? res.batchId : null,
    changed: res.changed,
    skipped: res.skipped.length,
  });
}
