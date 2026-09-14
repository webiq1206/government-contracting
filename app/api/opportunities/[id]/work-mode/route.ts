import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { opportunityWorkMode, outreachStopCounts, setOpportunityWorkMode } from "@/lib/work-mode";
import { outreachOffImpact, parseWorkMode } from "@/lib/domain/work-mode";
import { queryOne } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The record's mode and what turning outreach off would stop. */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;
  const owned = await queryOne<{ id: string }>(`select id from opportunities where id=$1 and org_id=$2`, [params.id, ctx.orgId]);
  if (!owned) return NextResponse.json({ error: "No such opportunity." }, { status: 404 });
  const [mode, counts] = await Promise.all([opportunityWorkMode(params.id), outreachStopCounts(ctx.orgId, params.id)]);
  return NextResponse.json({ ...mode, counts, impact: outreachOffImpact(counts) });
}

/**
 * Set who does the work on this opportunity.
 *
 * Body: `{ mode: "self" | "sub" | "mixed" | null, selfPerformedTrades?: string[] }`.
 * Null returns the record to the company default. Turning outreach off stops
 * scheduled follow-ups and prepared calls; turning it on sends nothing until
 * somebody asks for subcontractors on the record.
 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await requireOrgContext({ capability: "outreach" });
  if (ctx instanceof NextResponse) return ctx;
  const body = (await req.json().catch(() => ({}))) as { mode?: unknown; selfPerformedTrades?: unknown };
  const mode = body.mode == null ? null : parseWorkMode(body.mode);
  if (body.mode != null && mode == null) return NextResponse.json({ error: "Choose self-performed, subcontracted, or mixed." }, { status: 400 });
  const trades = Array.isArray(body.selfPerformedTrades) ? (body.selfPerformedTrades as unknown[]).filter((t): t is string => typeof t === "string") : [];
  const res = await setOpportunityWorkMode(ctx.orgId, params.id, { mode, selfPerformedTrades: trades, by: ctx.user.email ?? "operator" });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ ok: true, mode: res.after, stopped: res.stopped });
}
