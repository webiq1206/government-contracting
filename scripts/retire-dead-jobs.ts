/**
 * Retire queue jobs whose record no longer exists.
 *
 * A job queued against an opportunity that is later deleted (the expiry sweep
 * does this routinely) can never succeed. The runner now abandons such a job
 * on its first attempt instead of retrying it, so no new ones pile up, but
 * jobs queued before that change are still sitting in the queue as failures
 * with no explanation attached.
 *
 * Dry run by default: it prints what it would retire and changes nothing.
 * Pass --apply to delete. It acts on the database DATABASE_URL points at, so
 * run it where the backlog is.
 *
 *   npm run queue:retire-dead-jobs
 *   npm run queue:retire-dead-jobs -- --apply
 *
 * Run against production on 2026-08-18: six bid-builder jobs retired, all
 * pointing at deleted opportunities, none left afterwards.
 */
import { query } from "../lib/db";

const APPLY = process.argv.includes("--apply");

/**
 * Only jobs naming a record that is definitely absent. A job whose payload
 * names no record at all is untouched: a cron sweep has nothing to point at
 * and is not stuck.
 */
const DEAD = `
  (j.data->>'opportunityId' is not null
   and not exists (select 1 from opportunities o where o.id::text = j.data->>'opportunityId'))
  or
  (j.data->>'subcontractorId' is not null
   and not exists (select 1 from subcontractors s where s.id::text = j.data->>'subcontractorId'))
`;

interface DeadJob {
  id: string;
  name: string;
  state: string;
  opportunity_id: string | null;
  subcontractor_id: string | null;
}

async function main() {
  const dead = await query<DeadJob>(`
    select j.id, j.name, j.state,
           j.data->>'opportunityId' as opportunity_id,
           j.data->>'subcontractorId' as subcontractor_id
      from pgboss.job j
     where ${DEAD}
     order by j.name, j.state
  `);

  if (dead.length === 0) {
    console.log("No queue jobs are pointing at deleted records.");
    return;
  }

  console.log(`${dead.length} job(s) pointing at records that no longer exist:`);
  for (const j of dead) {
    const target = j.opportunity_id
      ? `opportunity ${j.opportunity_id}`
      : `subcontractor ${j.subcontractor_id}`;
    console.log(`  ${j.name} [${j.state}] ${target}`);
  }

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to retire them.");
    return;
  }

  const removed = await query<{ id: string }>(
    `delete from pgboss.job j where ${DEAD} returning j.id`
  );
  console.log(`\nRetired ${removed.length} job(s).`);

  const left = await query<{ n: string }>(
    `select count(*) as n from pgboss.job j where ${DEAD}`
  );
  console.log(`Remaining jobs against deleted records: ${left[0]?.n ?? "0"}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("retire-dead-jobs failed:", (err as Error).message);
    process.exit(1);
  });
