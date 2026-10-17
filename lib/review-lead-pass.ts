/**
 * Archive open opportunities whose response deadline is already too close.
 *
 * Runs for one organization. A second run matches nothing, because the
 * rows it changes are no longer open. Bid building and anything past it
 * are left where they are.
 */
import { query } from "./db";
import { logAgent } from "./logger";
import { stopOpportunityAutomation } from "./close-opportunity-work";
import { addBusinessDays, LEAD_PASS_NOTE, PAST_BID_BUILDING } from "./domain/review-lead";

export async function archiveReviewInsideLeadTime(
  orgId: string,
  businessDays: number,
  now = new Date(),
  options?: { dryRun?: boolean }
): Promise<{ id: string }[]> {
  if (!Number.isFinite(businessDays) || businessDays <= 0) return [];
  const cutoff = addBusinessDays(now, businessDays);
  const stages = [...PAST_BID_BUILDING];
  const predicate = `status = 'open'
        and is_sources_sought is not true
        and stage <> all($3::text[])
        and stage <> 'dismissed'
        and deadline is not null
        and deadline < $2`;
  if (options?.dryRun) {
    return query<{ id: string }>(
      `select id from opportunities where org_id = $1 and ${predicate}`,
      [orgId, cutoff.toISOString(), stages]
    );
  }
  const rows = await query<{ id: string }>(
    `update opportunities
        set stage = 'dismissed',
            status = 'archived',
            tier = 'dismiss',
            human_action_required = false,
            review_expires_at = null,
            review_warned_at = null,
            pursuit_state = 'aborted',
            pursuit_reason = 'passed',
            pursuit_changed_at = now(),
            pursuit_changed_by = 'review-lead-time',
            pursuit_version = pursuit_version + 1,
            notes = case
              when coalesce(notes, '') = '' then $4
              when position($4 in notes) > 0 then notes
              else notes || E'\n' || $4
            end
      where org_id = $1
        and ${predicate}
      returning id`,
    [orgId, cutoff.toISOString(), stages, LEAD_PASS_NOTE]
  );
  if (rows.length === 0) return [];
  await stopOpportunityAutomation(orgId, rows.map((row) => row.id), "passed");
  for (const row of rows) {
    await logAgent({
      agent: "review-expiry-sweep",
      action: "auto-pass: deadline",
      opportunityId: row.id,
      level: "info",
      message: LEAD_PASS_NOTE,
      reasoning: `The response deadline is inside ${businessDays} business day(s), which is the account's minimum bid lead time.`,
    });
  }
  return rows;
}
