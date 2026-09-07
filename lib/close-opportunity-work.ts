/**
 * Stop scheduled work when an opportunity leaves the active pipeline.
 *
 * The record change (pass, abort, expire) lives with the transition that
 * decided it. This is the shared cleanup those transitions must not forget:
 * clear pending follow-ups, take pending calls off the queue, and leave an
 * audit line that says why. History, emails, quotes, and files stay.
 */
import { transaction } from "@/lib/db";
import type { PoolClient } from "pg";
import { logAgent } from "@/lib/logger";
import { CLOSE_CAUSE_LABEL, type CloseCause } from "@/lib/domain/closed-work";

export interface StopWorkResult {
  followUpsStopped: number;
  callsClosed: number;
}

export async function stopOpportunityAutomation(
  orgId: string,
  opportunityIds: string[],
  cause: CloseCause,
  client?: PoolClient
): Promise<StopWorkResult> {
  const ids = opportunityIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (ids.length === 0) return { followUpsStopped: 0, callsClosed: 0 };

  const clean = async (db: PoolClient) => {
    const followUpResult = await db.query<{ id: string }>(
      `update communications
          set follow_up_at = null
        where org_id = $1
          and opportunity_id = any($2::uuid[])
          and follow_up_at is not null
        returning id`,
      [orgId, ids]
    );

    const callResult = await db.query<{ id: string }>(
      `update call_cards
          set status = 'skipped'
        where org_id = $1
          and opportunity_id = any($2::uuid[])
          and status = 'pending'
        returning id`,
      [orgId, ids]
    );
    return { followUps: followUpResult.rows, calls: callResult.rows };
  };
  const { followUps, calls } = client ? await clean(client) : await transaction(clean);

  if (followUps.length > 0 || calls.length > 0) {
    await logAgent({
      agent: "lifecycle",
      action: `stop-work-${cause}`,
      level: "info",
      opportunityId: ids.length === 1 ? ids[0] : undefined,
      message:
        `${CLOSE_CAUSE_LABEL[cause]}: stopped ${followUps.length} scheduled follow-up${
          followUps.length === 1 ? "" : "s"
        } and closed ${calls.length} pending call${calls.length === 1 ? "" : "s"}. ` +
        `Nothing was deleted.`,
    });
  }

  return { followUpsStopped: followUps.length, callsClosed: calls.length };
}
