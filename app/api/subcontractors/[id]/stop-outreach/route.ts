import { NextResponse } from "next/server";
import { requireOrgContext, notFoundResponse } from "@/lib/org-guard";
import { query, queryOne } from "@/lib/db";
import { logAgent } from "@/lib/logger";
import { SuppressionRejected, lift, stopImpact, suppress, suppressionsFor } from "@/lib/suppressions";
import {
  describeStopImpact,
  parseChannel,
  type StopOutreachScope,
} from "@/lib/domain/suppression";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stop outreach for one subcontractor, and say first what that cancels.
 *
 * GET previews. POST commits. They are separate calls on purpose: the same
 * button, on the same screen, can mean "cancel one follow-up" or "cancel
 * eleven queued messages and leave two trades with nobody quoting them", and
 * nothing in the label distinguishes them. The operator confirms against the
 * numbers rather than against a word.
 *
 * This never adds a global email suppression. That list is the
 * subcontractor's own decision, recorded when they ask to be removed; this is
 * the operator's, and it is scoped to the relationship they chose.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext({ capability: "view" });
  if (ctx instanceof NextResponse) return ctx;

  const sub = await queryOne<{ id: string; company_name: string }>(
    `select id, company_name from subcontractors where id = $1 and org_id = $2`,
    [params.id, ctx.orgId]
  );
  if (!sub) return notFoundResponse();

  const url = new URL(req.url);
  const scope = readScope(params.id, url.searchParams);
  const impact = await stopImpact(scope, ctx.orgId);

  return NextResponse.json({
    companyName: sub.company_name,
    impact,
    lines: describeStopImpact(impact, scope),
    existing: await suppressionsFor(params.id, ctx.orgId),
  });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext({ capability: "outreach" });
  if (ctx instanceof NextResponse) return ctx;

  const sub = await queryOne<{ id: string; company_name: string }>(
    `select id, company_name from subcontractors where id = $1 and org_id = $2`,
    [params.id, ctx.orgId]
  );
  if (!sub) return notFoundResponse();

  const body = (await req.json().catch(() => ({}))) as {
    opportunityId?: string | null;
    trade?: string | null;
    channel?: string;
    reason?: string;
    note?: string;
  };
  const scope: StopOutreachScope = {
    subcontractorId: params.id,
    opportunityId: body.opportunityId?.trim() || null,
    trade: body.trade?.trim() || null,
    channel: parseChannel(body.channel),
  };
  const reason = body.reason?.trim();
  if (!reason) {
    return NextResponse.json({ error: "Say why outreach is stopping." }, { status: 400 });
  }

  // Counted before anything is cancelled, so the audit line says what the
  // decision actually cost rather than that somebody pressed a button.
  const impact = await stopImpact(scope, ctx.orgId);

  try {
    const suppression = await suppress({
      orgId: ctx.orgId,
      subcontractorId: params.id,
      opportunityId: scope.opportunityId,
      trade: scope.trade,
      channel: scope.channel,
      reason,
      note: body.note ?? null,
      actor: ctx.user.email,
    });

    /*
     * Close the tasks the decision makes pointless.
     *
     * Only pending ones: a completed call is history and a skipped one
     * already carries its own reason. `stopped` is a distinct status from
     * `skipped` because they are different facts, and the instruction is
     * explicit that Skip, Pass, No response and the rest must not become
     * synonyms.
     */
    if (scope.channel !== "email") {
      await query(
        `update call_cards
            set status = 'skipped',
                skip_reason = 'handled_elsewhere',
                skip_note = $3,
                skip_scope = 'subcontractor',
                skipped_by = $4
          where subcontractor_id = $1
            and status = 'pending'
            and ($2::uuid is null or opportunity_id = $2)`,
        [params.id, scope.opportunityId, `Outreach stopped: ${reason}`, ctx.user.email]
      ).catch(() => undefined);
    }

    await logAgent({
      agent: "operator",
      action: "outreach-stopped",
      opportunityId: scope.opportunityId ?? undefined,
      subcontractorId: params.id,
      level: "warn",
      message: `${ctx.user.email} stopped outreach to ${sub.company_name}: ${reason}`,
      reasoning: describeStopImpact(impact, scope).join(" "),
    });

    return NextResponse.json({ ok: true, suppression, impact });
  } catch (err) {
    if (err instanceof SuppressionRejected) {
      return NextResponse.json({ error: err.reason }, { status: 400 });
    }
    throw err;
  }
}

/**
 * Start contacting them again.
 *
 * A lift is as much a decision as a stop, so it needs the same authorization
 * and leaves the same trail. The row is marked rather than deleted: "who
 * decided to start calling them again, and when" has to have an answer.
 */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext({ capability: "outreach" });
  if (ctx instanceof NextResponse) return ctx;

  const body = (await req.json().catch(() => ({}))) as { suppressionId?: string };
  if (!body.suppressionId) {
    return NextResponse.json({ error: "Say which stop to remove." }, { status: 400 });
  }
  const removed = await lift(body.suppressionId, ctx.orgId, ctx.user.email);
  if (!removed) {
    return NextResponse.json({ error: "That stop is not on this account, or is already lifted." }, { status: 404 });
  }
  await logAgent({
    agent: "operator",
    action: "outreach-resumed",
    subcontractorId: params.id,
    level: "info",
    message: `${ctx.user.email} allowed outreach to this subcontractor again.`,
  });
  return NextResponse.json({ ok: true });
}

function readScope(subcontractorId: string, q: URLSearchParams): StopOutreachScope {
  return {
    subcontractorId,
    opportunityId: q.get("opportunityId")?.trim() || null,
    trade: q.get("trade")?.trim() || null,
    channel: parseChannel(q.get("channel") ?? "all"),
  };
}
