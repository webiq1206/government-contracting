import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { logAgent } from "@/lib/logger";
import {
  isPerformanceKind,
  PERFORMANCE_LABEL,
  recordPerformance,
  retractPerformance,
} from "@/lib/subcontractor-performance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Record how a job went, or withdraw a record.
 *
 * Body to record: `{ kind, note?, opportunity_id? }`.
 * Body to withdraw: `{ action: "retract", event_id, reason }`.
 *
 * This is the only honest source for the performance half of the reliability
 * score. A contract closing says the paperwork finished, not that the crew
 * turned up, and no amount of reading email will tell you whether a wall is
 * straight. So a person writes it down, and the record says who and when.
 *
 * The capability is `decide` rather than `view`: a note here changes which
 * subcontractors get approached on every future bid.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext({ capability: "decide" });
  if (ctx instanceof NextResponse) return ctx;

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    kind?: string;
    note?: string;
    opportunity_id?: string | null;
    event_id?: string;
    reason?: string;
  };

  if (body.action === "retract") {
    if (!body.event_id) {
      return NextResponse.json({ error: "event_id is required." }, { status: 400 });
    }
    const res = await retractPerformance({
      orgId: ctx.orgId,
      eventId: body.event_id,
      reason: body.reason ?? "",
      actorId: ctx.user.id,
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    await logAgent({
      agent: "operator",
      action: "sub-performance-retracted",
      subcontractorId: params.id,
      level: "info",
      message: `Withdrew a performance record: ${(body.reason ?? "").trim()}`,
    });
    return NextResponse.json({
      ok: true,
      // Withdrawn, not deleted, and the message says so. Somebody who expected
      // the line to vanish should learn here that it did not.
      message: "Withdrawn. The record stays, marked, with your reason on it.",
    });
  }

  if (!isPerformanceKind(body.kind)) {
    return NextResponse.json({ error: "That is not something to record." }, { status: 400 });
  }

  const res = await recordPerformance({
    orgId: ctx.orgId,
    subcontractorId: params.id,
    opportunityId: body.opportunity_id ?? null,
    kind: body.kind,
    note: body.note,
    actorId: ctx.user.id,
    actorEmail: ctx.user.email,
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });

  await logAgent({
    agent: "operator",
    action: "sub-performance-recorded",
    subcontractorId: params.id,
    opportunityId: body.opportunity_id ?? undefined,
    level: "info",
    message: `${PERFORMANCE_LABEL[body.kind]}${(body.note ?? "").trim() ? `: ${(body.note ?? "").trim()}` : "."}`,
  });

  return NextResponse.json({
    ok: true,
    id: res.id,
    /*
     * The score is rewritten by the nightly run, not here. Saying "saved, and
     * the score has changed" would be a claim about a column this route does
     * not touch, and an operator refreshing to check would find the old
     * number and stop believing the messages.
     */
    message: "Saved. The reliability score takes it into account on the next nightly run.",
  });
}
