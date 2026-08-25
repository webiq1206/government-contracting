import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import {
  areCallsEnabled,
  AUTOMATION_PAUSED_ERROR,
  isAutomationPaused,
} from "@/lib/app-settings";
import { CALL_STAGE, STAGE_AFTER_CALLS, withoutCallStage } from "@/lib/domain/call-step";
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
  const ctx = await requireOrgContext({ capability: "decide" });
  if (ctx instanceof NextResponse) return ctx;
  const { user: auth, orgId } = ctx;

  const { action, stage: targetStage } = await req.json().catch(() => ({}));
  const opp = await queryOne<{ id: string; stage: string }>(
    `select id, stage from opportunities where id=$1 and org_id=$2`,
    [params.id, orgId]
  );
  if (!opp) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (action === "pursue" || action === "rerun" || action === "send_back" || action === "move") {
    if (await isAutomationPaused()) {
      return NextResponse.json({ error: AUTOMATION_PAUSED_ERROR }, { status: 409 });
    }
  }


  /**
   * Drag-and-drop and the card menu's "Move to". The operator overrides the
   * pipeline's own routing, so the move re-runs the target stage's agents:
   * dropping a card on Analysis re-analyzes it, dropping it on Outreach
   * re-runs outreach for its paired subs. Stages with no agent (quote entry,
   * submitted) flag for the human work they exist for. Guardrails live in
   * resolveManualMove; agents keep their own (bid-builder refuses a $0 bid,
   * outreach refuses an incomplete brief), so a hopeful drop degrades to a
   * named blocker rather than a bad artifact.
   */
  if (action === "move") {
    const { resolveManualMove } = await import("@/lib/domain/stage-move");
    const callsEnabled = await areCallsEnabled();
    const resolved = resolveManualMove(opp.stage, String(targetStage ?? ""), callsEnabled);
    if (!resolved.ok || !resolved.stage) {
      return NextResponse.json({ error: resolved.error ?? "That move is not allowed." }, { status: 400 });
    }
    const agents = STAGE_AGENTS[resolved.stage] ?? [];
    await query(
      `update opportunities
          set stage=$2, status='open', human_action_required=$3, review_expires_at=null
        where id=$1`,
      [params.id, resolved.stage, agents.length === 0]
    );
    for (const a of agents) await enqueue(a, { opportunityId: params.id });
    await logAgent({
      agent: "operator",
      action: "move",
      opportunityId: params.id,
      level: "info",
      message: `Operator ${auth.email} moved opportunity from ${opp.stage.replace(/_/g, " ")} to ${resolved.stage.replace(/_/g, " ")}${agents.length ? ` (${agents.join(", ")} queued)` : ""}.`,
    });
    return NextResponse.json({ ok: true, stage: resolved.stage, requeued: agents });
  }

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

  // Undo a dismissal: back to the review queue with a fresh decision timer.
  // Only dismissed records restore this way; anything else is a no-op error.
  if (action === "restore") {
    if (opp.stage !== "dismissed") {
      return NextResponse.json(
        { error: "Only dismissed opportunities can be restored." },
        { status: 400 }
      );
    }
    await query(
      `update opportunities
          set tier='review', stage='scoring', status='open',
              human_action_required=true,
              review_expires_at=now() + interval '24 hours'
        where id=$1`,
      [params.id]
    );
    await logAgent({
      agent: "operator",
      action: "restore",
      opportunityId: params.id,
      level: "info",
      message: `Operator ${auth.email} restored a dismissed opportunity to the review queue (24h decision timer).`,
    });
    return NextResponse.json({ ok: true, stage: "scoring" });
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
    // Calling off means the call stage is not part of this account's pipeline,
    // so stepping back through it would park the record in a stage nothing
    // will ever pick up. Step over it to the stage before instead.
    const callsEnabled = await areCallsEnabled();
    const stageOrder = withoutCallStage(STAGE_ORDER, callsEnabled);
    // A record left in the call stage from before calling was turned off is
    // treated as if it were already at the stage that replaced it.
    const from =
      !callsEnabled && opp.stage === CALL_STAGE ? STAGE_AFTER_CALLS : opp.stage;
    const idx = stageOrder.indexOf(from);
    // Clamp to "scoring" (index 1); never fall back into cron-driven monitoring.
    if (idx <= 1) {
      return NextResponse.json(
        { error: "This opportunity is already at the earliest stage you can send it back to." },
        { status: 400 }
      );
    }
    const prev = stageOrder[idx - 1];
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
