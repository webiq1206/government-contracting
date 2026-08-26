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

  await suspectBids();
  await closePool();
}

/**
 * Bids that may be claiming they are ready to submit when they are not.
 *
 * Until 069, a compliance audit that could not run kept only the
 * deterministic `elig_*` findings and recomputed readiness from what
 * survived, discarding the AI findings from the last completed audit. So a
 * package held back by an AI blocker could be marked ready by a run that had
 * read nothing, which happens whenever the AI is unreachable or out of
 * credit.
 *
 * The fix stops it happening again. It does not correct rows already written
 * that way: those stay as they are until the auditor next runs on them. This
 * lists them so somebody can decide, rather than leaving the product telling
 * an operator a package is ready when the only thing that cleared it was an
 * audit that never happened.
 *
 * `audit_ran_at is null` means the AI pass has never completed on that bid,
 * which is not the same as a clean audit and must not be read as one.
 */
async function suspectBids() {
  const rows = await query<{
    opportunity: string | null;
    audit_status: string | null;
    audit_ran_at: string | null;
    open_ai_blockers: number;
  }>(
    `select o.title as opportunity,
            b.audit_status,
            b.audit_ran_at::text as audit_ran_at,
            (select count(*)
               from jsonb_array_elements(coalesce(b.audit_findings, '[]'::jsonb)) f
              where f->>'severity' = 'blocker'
                and coalesce((f->>'acknowledged')::boolean, false) = false
                and left(coalesce(f->>'id', ''), 5) <> 'elig_'
            )::int as open_ai_blockers
       from bids b
       left join opportunities o on o.id = b.opportunity_id
      where b.package_ready = true
        and coalesce(b.audit_status, '') = 'skipped'
      order by b.updated_at desc`
  );

  console.log("\nBids marked ready by an audit that could not run:");
  if (rows.length === 0) {
    console.log("  none. Nothing to correct.");
    return;
  }
  console.table(rows);
  console.log(
    `  ${rows.length} bid(s). Each is marked ready with its last audit recorded as skipped.\n` +
      "  Re-running the compliance auditor on these recomputes readiness from everything\n" +
      "  still known, which is the fix. Do that once the AI is reachable again."
  );
}

main().catch(async (err) => {
  console.error((err as Error).message);
  await closePool().catch(() => {});
  process.exit(1);
});
