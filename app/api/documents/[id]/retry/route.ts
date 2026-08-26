import { NextResponse } from "next/server";
import { requireOrgContext, notFoundResponse } from "@/lib/org-guard";
import { query, queryOne } from "@/lib/db";
import { enqueue } from "@/lib/queue";
import { logAgent } from "@/lib/logger";
import { LEGACY_ORG_ID } from "@/lib/tenant-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Try again on a document that could not be read.
 *
 * POST /api/documents/[id]/retry
 *
 * What this honestly does: clears the failure on this one document and
 * re-queues the solicitation analyst for the whole opportunity. There is no
 * per-file extraction path, and pretending otherwise with a button labelled
 * "retry this document" would be a lie about what the operator just started.
 * The response says which it is so the UI can too.
 *
 * The retry count goes up whether or not it works. A document on its fourth
 * attempt is telling somebody that retrying is not the answer, and a counter
 * that only records successes cannot say that.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext({ capability: "run_agents" });
  if (ctx instanceof NextResponse) return ctx;

  const doc = await queryOne<{
    id: string;
    org_id: string | null;
    opportunity_id: string | null;
    name: string;
    retry_count: number;
    extraction_state: string;
  }>(
    `select id, org_id, opportunity_id, name, retry_count, extraction_state
       from documents where id = $1`,
    [params.id]
  );
  const owned =
    doc != null && (doc.org_id === ctx.orgId || (doc.org_id === null && ctx.orgId === LEGACY_ORG_ID));
  if (!owned || !doc?.opportunity_id) return notFoundResponse();

  await query(
    `update documents set extraction_state='pending', last_error=null, retry_count = retry_count + 1
      where id = $1`,
    [doc.id]
  );

  const jobId = await enqueue("solicitation-analyst", { opportunityId: doc.opportunity_id });
  if (!jobId) {
    /*
     * The enqueue refused: automation is paused, or this pursuit has been
     * stopped. Put the document back in the state it was actually in, rather
     * than leaving it reading "not processed yet" forever with nothing coming
     * to process it.
     *
     * The state it was in, specifically. Writing a fixed value here would
     * label a document that was merely unread as unreadable, which is a
     * different and worse fact about the same file, invented by a rollback.
     */
    await query(`update documents set extraction_state=$2 where id = $1`, [
      doc.id,
      doc.extraction_state,
    ]);
    return NextResponse.json(
      {
        error:
          "Nothing was queued. Automation is paused, or this pursuit has been stopped. Restart it first and try again.",
      },
      { status: 409 }
    );
  }

  await logAgent({
    agent: "operator",
    action: "extraction_retried",
    opportunityId: doc.opportunity_id,
    level: "info",
    message: `${ctx.user.email} asked for another read of ${doc.name} (attempt ${doc.retry_count + 2}). The whole solicitation is re-analysed, not this file alone.`,
  });

  return NextResponse.json({
    ok: true,
    // Said plainly so the UI can say it too.
    scope: "opportunity",
    message: "Re-reading every document on this opportunity. This usually takes a few minutes.",
  });
}
