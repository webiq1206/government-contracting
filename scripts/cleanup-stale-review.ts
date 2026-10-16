/**
 * Preview or archive open opportunities whose response deadline is too close.
 *
 * Idempotent. Rows it archives no longer match the predicate, so a second
 * run reports zero. It only updates matching opportunity rows.
 *
 *   npx tsx scripts/cleanup-stale-review.ts --dry-run
 *   npx tsx scripts/cleanup-stale-review.ts --apply
 *
 * Dry-run is the default. Uses DATABASE_URL. Do not point it at production.
 */
import { query } from "../lib/db";
import { listActiveOrganizations } from "../lib/organizations";
import { getAutomationRules } from "../lib/app-settings";
import { runWithOrg } from "../lib/tenant-context";
import { addBusinessDays, LEAD_PASS_NOTE, PAST_BID_BUILDING } from "../lib/domain/review-lead";
import { archiveReviewInsideLeadTime } from "../lib/review-lead-pass";
import { classifyBacklogRow, type BacklogRow } from "../lib/domain/backlog-disposition";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const orgs = await listActiveOrganizations();
  const preview: ReturnType<typeof classifyBacklogRow>[] = [];
  for (const org of orgs) {
    const rules = await runWithOrg(org.id, () => getAutomationRules());
    const days = rules.min_bid_lead_business_days;
    if (days <= 0) {
      console.log(`${org.id}: lead-time pass is off`);
      continue;
    }
    const now = new Date();
    const cutoff = addBusinessDays(now, days);
    const rows = await query<BacklogRow & { risk_flags: string[] | null; sources_sought: boolean | null }>(
      `select id, title, deadline::text as deadline, status, tier, stage,
              risk_flags, is_sources_sought as sources_sought
         from opportunities
        where org_id = $1
          and status = 'open'
          and is_sources_sought is not true
          and stage <> all($3::text[])
          and deadline is not null
          and deadline < $2`,
      [org.id, cutoff.toISOString(), [...PAST_BID_BUILDING, "dismissed"]]
    );
    for (const row of rows) {
      preview.push(
        classifyBacklogRow(
          {
            id: row.id,
            title: row.title,
            deadline: row.deadline,
            status: row.status,
            tier: row.tier,
            stage: row.stage,
            riskFlags: row.risk_flags ?? [],
            sourcesSought: Boolean(row.sources_sought),
          },
          now,
          days
        )
      );
    }
    if (apply && rows.length > 0) {
      const archived = await runWithOrg(org.id, () => archiveReviewInsideLeadTime(org.id, days, now));
      console.log(`${org.id}: archived ${archived.length}. ${LEAD_PASS_NOTE}`);
    }
  }
  const archive = preview.filter((row) => row.action === "archive");
  console.log(JSON.stringify({ dryRun: !apply, archiveCount: archive.length, items: archive }, null, 2));
  if (!apply) console.log("Dry run. Re-run with --apply to write.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
