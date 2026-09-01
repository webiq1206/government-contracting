import { query } from "@/lib/db";
import { enqueue } from "@/lib/queue";
import { logAgent } from "@/lib/logger";
import { stopOpportunityAutomation } from "@/lib/close-opportunity-work";

/**
 * The three stage changes an operator can make, in one place.
 *
 * They were written twice: once in the single-record action route and once in
 * the bulk route, as two copies of the same UPDATE. The copies agreed when
 * they were written, which is the only time copies ever do. Adding
 * `review_warned_at` proved it immediately: the column has to be cleared when
 * a record leaves review, and a change made in one route would have left the
 * other able to dismiss a record whose warning belonged to a previous life.
 *
 * The board's drag, the card menu, the Review panel and the bulk bar all end
 * up here, which is what "the same guarded transition service as every other
 * stage change" means.
 */

/** Agents that produce a stage's work. Human-only stages have none. */
export const STAGE_AGENTS: Record<string, string[]> = {
  scoring: ["scoring-engine"],
  analysis: ["solicitation-analyst", "pricing-research"],
  sub_research: ["sub-finder"],
  outreach: ["outreach"],
  call_queue: ["call-prep"],
  bid_building: ["bid-builder"],
};

/**
 * Promote a review-tier opportunity and start the work.
 *
 * Scoped by organization in the WHERE clause rather than checked first: a
 * read-then-write leaves a window, and puts the guard somewhere a later edit
 * can remove without a test noticing.
 *
 * Returns false when the record is not this organization's, so the caller can
 * answer 404 rather than reveal that it exists.
 */
export async function pursueOpportunity(
  orgId: string,
  id: string,
  actorEmail: string
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `update opportunities
        set tier='pursue', stage='analysis', human_action_required=false,
            review_expires_at=null,
            -- Leaving review ends the warning with it. A record that comes
            -- back here later must be warned again on its own merits, not
            -- carry a warning issued about a decision somebody already made.
            review_warned_at=null
      where id=$1 and org_id=$2
      returning id`,
    [id, orgId]
  );
  if (rows.length === 0) return false;
  for (const agent of STAGE_AGENTS.analysis!) {
    await enqueue(agent, { opportunityId: id });
  }
  await logAgent({
    agent: "operator",
    action: "pursue",
    opportunityId: id,
    level: "info",
    message: `Operator ${actorEmail} promoted opportunity to pursue.`,
  });
  return true;
}

/**
 * Archive an opportunity with the operator's reason.
 *
 * The reason is appended to the notes rather than replacing them, because the
 * notes are where somebody wrote down what they learned about this job and a
 * pass is one more thing that happened to it.
 */
export async function passOpportunity(
  orgId: string,
  id: string,
  reason: string,
  actorEmail: string
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `update opportunities
        set tier='dismiss', stage='dismissed', status='archived',
            human_action_required=false, review_expires_at=null, review_warned_at=null,
            pursuit_state='aborted',
            pursuit_reason='passed',
            pursuit_changed_at=now(),
            pursuit_changed_by=$4,
            notes = case
              when coalesce(notes, '') = '' then $3
              else notes || E'\n' || $3
            end
      where id=$1 and org_id=$2
      returning id`,
    [id, orgId, `Passed: ${reason}`, actorEmail]
  );
  if (rows.length === 0) return false;
  await stopOpportunityAutomation(orgId, [id], "passed");
  await logAgent({
    agent: "operator",
    action: "dismiss",
    opportunityId: id,
    level: "info",
    message: `Operator ${actorEmail} passed on opportunity: ${reason}`,
  });
  return true;
}

/**
 * Move to a named stage and re-run that stage's work.
 *
 * The caller resolves and validates the target first; this is the write. A
 * stage with no agent flags for the human work it exists for, which is why the
 * flag is derived from the agent list rather than passed in: those two facts
 * cannot be allowed to disagree.
 */
export async function moveOpportunity(
  orgId: string,
  id: string,
  stage: string,
  actorEmail: string,
  fromStage: string
): Promise<{ ok: boolean; requeued: string[] }> {
  const agents = STAGE_AGENTS[stage] ?? [];
  const rows = await query<{ id: string }>(
    `update opportunities
        set stage=$3, status='open', human_action_required=$4,
            review_expires_at=null, review_warned_at=null
      where id=$1 and org_id=$2
      returning id`,
    [id, orgId, stage, agents.length === 0]
  );
  if (rows.length === 0) return { ok: false, requeued: [] };
  for (const agent of agents) await enqueue(agent, { opportunityId: id });
  await logAgent({
    agent: "operator",
    action: "move",
    opportunityId: id,
    level: "info",
    message: `Operator ${actorEmail} moved opportunity from ${fromStage.replace(/_/g, " ")} to ${stage.replace(/_/g, " ")}${agents.length ? ` (${agents.join(", ")} queued)` : ""}.`,
  });
  return { ok: true, requeued: agents };
}
