import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { logAgent } from "@/lib/logger";
import {
  archiveSubcontractor,
  mergeSubcontractors,
  planMerge,
  restoreSubcontractor,
  undoMerge,
} from "@/lib/subcontractor-merge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What a merge would do, before anybody commits to it.
 *
 * A separate read so the confirmation an operator sees is the same arithmetic
 * the merge runs, rather than an estimate of it. A dialog that says "moves 40
 * emails" and then moves 38 teaches somebody not to read the dialog.
 *
 * `?into=<id>` names the record that survives. This route's own id is the one
 * being folded in.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext({ capability: "decide" });
  if (ctx instanceof NextResponse) return ctx;

  const into = new URL(req.url).searchParams.get("into") ?? "";
  if (!into) {
    return NextResponse.json({ error: "Say which record survives." }, { status: 400 });
  }
  const plan = await planMerge(ctx.orgId, into, params.id);
  // 404 rather than 403: a record in another organization must not be
  // distinguishable from one that does not exist.
  if (!plan) return NextResponse.json({ error: "No such pair of records." }, { status: 404 });
  return NextResponse.json({ ok: true, plan });
}

/**
 * Merge, undo a merge, put a record aside, or bring one back.
 *
 * Body: `{ action: "merge", into, keep? }`, `{ action: "undo", merge_id }`,
 * `{ action: "archive", reason }`, or `{ action: "restore" }`.
 *
 * Nothing here deletes a subcontractor. A merged record stays as a tombstone
 * pointing at the survivor, so an old link still resolves and an old id in
 * somebody's notes still means something, and an archived one is simply out of
 * the default list. The roster's delete button was the only tool for a
 * duplicate, and it took the emails, quotes and pairings with it: the record of
 * who was approached for a federal bid.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext({ capability: "decide" });
  if (ctx instanceof NextResponse) return ctx;

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    into?: string;
    keep?: Record<string, "survivor" | "merged">;
    merge_id?: string;
    reason?: string;
  };

  switch (body.action) {
    case "merge": {
      if (!body.into) {
        return NextResponse.json({ error: "Say which record survives." }, { status: 400 });
      }
      if (body.into === params.id) {
        return NextResponse.json(
          { error: "A record cannot be folded into itself." },
          { status: 400 }
        );
      }
      const res = await mergeSubcontractors({
        orgId: ctx.orgId,
        survivorId: body.into,
        mergedId: params.id,
        keep: body.keep,
        actorId: ctx.user.id,
        actorEmail: ctx.user.email,
      });
      if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
      await logAgent({
        agent: "operator",
        action: "sub-merged",
        subcontractorId: body.into,
        level: "info",
        message: `Folded one roster record into another. ${res.moved} records moved${res.reversible ? " and can be put back" : ", and this cannot be undone"}.`,
      });
      return NextResponse.json({
        ok: true,
        mergeId: res.mergeId,
        message: res.reversible
          ? `Merged. ${res.moved} records moved, and this can be undone.`
          : `Merged. ${res.moved} records moved. This one cannot be undone.`,
      });
    }

    case "undo": {
      if (!body.merge_id) {
        return NextResponse.json({ error: "Which merge?" }, { status: 400 });
      }
      const res = await undoMerge({
        orgId: ctx.orgId,
        mergeId: body.merge_id,
        actorId: ctx.user.id,
      });
      if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
      await logAgent({
        agent: "operator",
        action: "sub-merge-undone",
        subcontractorId: params.id,
        level: "info",
        message: `Undid a merge. ${res.moved} records went back.`,
      });
      return NextResponse.json({
        ok: true,
        message: `Put back. ${res.moved} records returned to the separated record.`,
      });
    }

    case "archive": {
      const res = await archiveSubcontractor({
        orgId: ctx.orgId,
        subcontractorId: params.id,
        reason: body.reason ?? "",
        actorId: ctx.user.id,
      });
      if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
      await logAgent({
        agent: "operator",
        action: "sub-archived",
        subcontractorId: params.id,
        level: "info",
        message: `Put aside: ${(body.reason ?? "").trim()}`,
      });
      return NextResponse.json({
        ok: true,
        /*
         * Says what it is not, because the two look the same on a roster and
         * are different statements about a firm. Somebody who meant "do not
         * use these" should learn here that they have not said that.
         */
        message:
          "Put aside. Everything is kept, and this is not the same as marking them do not use.",
      });
    }

    case "restore": {
      const res = await restoreSubcontractor({
        orgId: ctx.orgId,
        subcontractorId: params.id,
      });
      if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
      await logAgent({
        agent: "operator",
        action: "sub-restored",
        subcontractorId: params.id,
        level: "info",
        message: "Brought back onto the roster.",
      });
      return NextResponse.json({ ok: true, message: "Back on the roster." });
    }

    default:
      return NextResponse.json({ error: "That is not something to do here." }, { status: 400 });
  }
}
