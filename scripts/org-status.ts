/**
 * Every organization, with the fields that decide whether the agents work
 * for it. Read-only: it selects and prints, and writes nothing.
 *
 * This exists because "why is the doctor calling a canceled account active?"
 * had no answer short of hand-writing SQL, and the shell is a bad place to
 * hand-write SQL against production.
 *
 * `listActiveOrganizations` includes an organization when it is not suspended
 * AND (it is billing_exempt OR its status is active/trialing/past_due OR it is
 * a trial that has not expired). So a `canceled` organization the agents still
 * work for is being kept alive by `billing_exempt`, and this prints the column
 * that says so.
 *
 *   npm run org-status                        (whatever this shell points at)
 *   USE_REPLIT_DEV_DB=false npm run org-status   (production, from a workspace)
 */
import "../lib/env";
import { query, closePool } from "../lib/db";
import { config } from "../lib/config";

/**
 * Which database this read describes, said before the table rather than after.
 *
 * The workspace shell defaults to the repl's built-in development database, so
 * an identical-looking table can describe either one. A report that does not
 * name its source invites somebody to act on dev numbers.
 */
function target(): string {
  return config.database.isIsolatedDev
    ? "the repl's built-in DEV database (not your live data)"
    : "DATABASE_URL (production)";
}

interface OrgRow {
  name: string;
  subscription_status: string | null;
  billing_exempt: boolean;
  trial_ends_at: string | null;
  suspended_at: string | null;
  agents_work_for_it: string;
}

async function main() {
  console.log(`reading: ${target()}\n`);

  const rows = await query<OrgRow>(
    `select name,
            subscription_status,
            coalesce(billing_exempt, false) as billing_exempt,
            trial_ends_at::text as trial_ends_at,
            suspended_at::text  as suspended_at,
            /*
             * The same predicate listActiveOrganizations uses, so this column
             * answers the actual question rather than inviting somebody to
             * work it out from the other four and get it wrong.
             */
            case
              when suspended_at is not null then 'no (suspended)'
              when coalesce(billing_exempt, false) then 'yes (comped)'
              when subscription_status in ('active','trialing','past_due')
                then 'yes (' || subscription_status || ')'
              when subscription_status = 'trial' and trial_ends_at > now()
                then 'yes (trial running)'
              else 'no'
            end as agents_work_for_it
       from organizations
      order by created_at`
  );

  console.table(rows);
  console.log(
    `\n${rows.length} organization(s). "agents_work_for_it" is the same rule listActiveOrganizations applies.`
  );
  await closePool();
}

main().catch(async (err) => {
  console.error((err as Error).message);
  await closePool().catch(() => {});
  process.exit(1);
});
