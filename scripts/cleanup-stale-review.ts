/**
 * Archive open review items whose response deadline is already too close.
 *
 * Idempotent. Rows it archives no longer match the predicate, so a second
 * run reports zero. It updates those rows and stops their scheduled work.
 * It only updates matching opportunity rows. Existing tables stay in place.
 *
 *   npx tsx scripts/cleanup-stale-review.ts            # dry run
 *   npx tsx scripts/cleanup-stale-review.ts --apply    # write
 *
 * Uses DATABASE_URL for the local database. Do not point it at production.
 */
import { query } from "../lib/db";
import { listActiveOrganizations } from "../lib/organizations";
import { getAutomationRules } from "../lib/app-settings";
import { runWithOrg } from "../lib/tenant-context";
import { addBusinessDays, LEAD_PASS_NOTE } from "../lib/domain/review-lead";
import { archiveReviewInsideLeadTime } from "../lib/review-lead-pass";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const orgs = await listActiveOrganizations();
  let matched = 0;
  for (const org of orgs) {
    const rules = await runWithOrg(org.id, () => getAutomationRules());
    const days = rules.review_close_lead_business_days;
    if (days <= 0) {
      console.log(`${org.id}: lead-time pass is off`);
      continue;
    }
    const cutoff = addBusinessDays(new Date(), days);
    const rows = await query<{ id: string }>(
      `select id from opportunities
        where org_id = $1
          and status = 'open'
          and tier = 'review'
          and human_action_required = true
          and stage in ('monitoring', 'scoring')
          and is_sources_sought is not true
          and coalesce(pursuit_state, 'active') = 'active'
          and deadline is not null
          and deadline < $2`,
      [org.id, cutoff.toISOString()]
    );
    matched += rows.length;
    console.log(`${org.id}: ${rows.length} review item(s) inside ${days} business day(s)`);
    if (apply && rows.length > 0) {
      const archived = await runWithOrg(org.id, () => archiveReviewInsideLeadTime(org.id, days));
      console.log(`${org.id}: archived ${archived.length}. ${LEAD_PASS_NOTE}`);
    }
  }
  console.log(apply ? `Applied. ${matched} item(s) matched.` : `Dry run. ${matched} item(s) would be archived. Re-run with --apply to write.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
