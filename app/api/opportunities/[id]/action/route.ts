import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { query, queryOne } from "@/lib/db";
import { enqueue } from "@/lib/queue";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Operator overrides on a single opportunity, triggered from the Review Queue
 * or the per-card menu on the Pipeline board:
 *   pursue    - promote a review-tier opp and kick off analysis
 *   dismiss   - archive it
 *   rerun     - re-queue the agent(s) that produce the current stage (stalled agent)
 *   send_back - move one stage earlier and re-run that stage's work
 */

// Stages the pipeline moves through, in order. "monitoring" is pre-scoring and
// driven by a global cron, so operator moves clamp to "scoring" and later.
const STAGE_ORDER = [
  "monitoring",
  "scoring",
  "analysis",
  "sub_research",
  "outreach",
  "call_queue",
  "quote_entry",
  "bid_building",
  "submitted",
];

// The agent(s) that produce the work for a given stage. Re-running or sending
// back to a stage re-enqueues these. Human-only stages (quote_entry) have none.
const STAGE_AGENTS: Record<string, string[]> = {
  scoring: ["scoring-engine"],
  analysis: ["solicitation-analyst", "pricing-research"],
  sub_research: ["sub-finder"],
  outreach: ["outreach"],
  call_queue: ["call-prep"],
  bid_building: ["bid-builder"],
};

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

  if (action === "rerun") {
    const agents = STAGE_AGENTS[opp.stage] ?? [];
    if (agents.length === 0) {
      return NextResponse.json(
        { error: "This stage is a manual step, so there is nothing to re-run." },
        { status: 400 }
      );
    }
    // Clear the human-action flag so the agent reprocesses cleanly.
    await query(`update opportunities set human_action_required=false where id=$1`, [
      params.id,
    ]);
    for (const a of agents) await enqueue(a, { opportunityId: params.id });
    await logAgent({
      agent: "operator",
      action: "rerun",
      opportunityId: params.id,
      level: "info",
      message: `Operator ${auth.email} re-ran the ${opp.stage.replace(/_/g, " ")} stage (${agents.join(", ")}).`,
    });
    return NextResponse.json({ ok: true, stage: opp.stage, requeued: agents });
  }

  if (action === "send_back") {
    const idx = STAGE_ORDER.indexOf(opp.stage);
    // Clamp to "scoring" (index 1); never fall back into cron-driven monitoring.
    if (idx <= 1) {
      return NextResponse.json(
        { error: "This opportunity is already at the earliest stage you can send it back to." },
        { status: 400 }
      );
    }
    const prev = STAGE_ORDER[idx - 1];
    const agents = STAGE_AGENTS[prev] ?? [];
    await query(
      `update opportunities
          set stage=$2, status='open', human_action_required=$3
        where id=$1`,
      [params.id, prev, agents.length === 0]
    );
    for (const a of agents) await enqueue(a, { opportunityId: params.id });
    await logAgent({
      agent: "operator",
      action: "send_back",
      opportunityId: params.id,
      level: "info",
      message: `Operator ${auth.email} sent opportunity back to ${prev.replace(/_/g, " ")}.`,
    });
    return NextResponse.json({ ok: true, stage: prev, requeued: agents });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
