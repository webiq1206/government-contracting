import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { query, queryOne } from "@/lib/db";
import { enqueue } from "@/lib/queue";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Pursue / dismiss a review-tier opportunity (Review Queue triage). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const { action } = await req.json().catch(() => ({}));
  const opp = await queryOne<{ id: string; stage: string }>(
    `select id, stage from opportunities where id=$1`,
    [params.id]
  );
  if (!opp) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (action === "pursue") {
    await query(
      `update opportunities
          set tier='pursue', stage='analysis', human_action_required=false, review_expires_at=null
        where id=$1`,
      [params.id]
    );
    await enqueue("solicitation-analyst", { opportunityId: params.id });
    await enqueue("pricing-research", { opportunityId: params.id });
    await logAgent({
      agent: "operator",
      action: "pursue",
      opportunityId: params.id,
      level: "info",
      message: `Operator ${auth.email} promoted opportunity to pursue.`,
    });
    return NextResponse.json({ ok: true, stage: "analysis" });
  }

  if (action === "dismiss") {
    await query(
      `update opportunities set tier='dismiss', stage='dismissed', status='archived',
              human_action_required=false, review_expires_at=null where id=$1`,
      [params.id]
    );
    await logAgent({
      agent: "operator",
      action: "dismiss",
      opportunityId: params.id,
      level: "info",
      message: `Operator ${auth.email} dismissed opportunity.`,
    });
    return NextResponse.json({ ok: true, stage: "dismissed" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
