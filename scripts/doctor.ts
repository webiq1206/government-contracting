/**
 * Production doctor.
 *
 *   npm run doctor
 *
 * Answers one question directly: "why isn't the system finding deals and
 * sending emails?" It runs against whatever DATABASE_URL and environment the
 * process is started with, so run it in the SAME place the app runs (the
 * Replit shell of the deployment), where it can see the real database, the
 * real secrets, and the real worker heartbeat.
 *
 * Every check prints PASS / WARN / FAIL and, when it fails, the exact fix. It
 * exits non-zero if any FAIL is found, so it is safe to wire into a check.
 *
 * It reads only. It changes nothing.
 */
import "../lib/env";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../lib/config";
import { query, queryOne, dbHealthy } from "../lib/db";
import { readWorkerHeartbeat, READY_PHASE } from "../lib/worker-heartbeat";
import { isAutomationPaused } from "../lib/app-settings";
import { gmail } from "../lib/integrations/gmail";
import { orgHasKey } from "../lib/integration-keys";
import { scheduledAgents } from "../lib/agents/registry";
import { listActiveOrganizations } from "../lib/organizations";
import { looksLikeTestOrg, hasGeneratedTag } from "../lib/domain/test-org-match";

type Status = "PASS" | "WARN" | "FAIL";
const results: { status: Status; title: string; fix?: string }[] = [];
function check(status: Status, title: string, fix?: string) {
  results.push({ status, title, fix });
}

function hoursSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}
function minutesSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 60_000;
}
/** Timestamps are for comparing across runs, so print them short and sortable. */
function isoOrRaw(value: string | Date | null | undefined): string {
  if (!value) return "unknown";
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString().replace(".000", "");
}

/** Host and port only. A connection string carries a password; this report does not. */
function dbTarget(url: string): string {
  try {
    const u = new URL(url);
    const db = u.pathname.replace(/^\//, "") || "?";
    // A unix-socket URL carries no hostname; the path lives in ?host=.
    const host = u.hostname || u.searchParams.get("host") || "local socket";
    return `${host}:${u.port || u.searchParams.get("port") || "5432"}/${db}`;
  } catch {
    // A unix-socket connection string ("postgres://user@/db?host=/tmp/sock")
    // is not a valid URL at all, so fall back to reading it by shape. The
    // userinfo group is matched only to discard it: no password reaches this
    // report by any path.
    const m = /^[a-z0-9+]+:\/\/(?:[^@/]*@)?([^/?#]*)\/?([^?#]*)/i.exec(url);
    const socket = /[?&]host=([^&]+)/.exec(url)?.[1];
    const port = /[?&]port=(\d+)/.exec(url)?.[1] ?? "5432";
    return `${m?.[1] || socket || "local socket"}:${port}/${m?.[2] || "?"}`;
  }
}

/**
 * A deployed process, as opposed to the workspace shell. Either marker counts,
 * matching lib/config so the two can never disagree about which world this is.
 */
function isDeployment(): boolean {
  return (process.env.REPLIT_DEPLOYMENT ?? "") !== "" || (process.env.REPLIT_DEPLOYMENT_ID ?? "") !== "";
}

async function main() {
  console.log("\nBROSTCO doctor — why the engine may be quiet\n" + "=".repeat(52));

  // ---- 0. WHERE AM I? ----
  //
  // Every finding below is about one specific database and one specific
  // process, and the report used to name neither. That ambiguity is not
  // cosmetic: the workspace deliberately runs with RUN_WORKER=false against
  // the repl's own built-in database, so a frozen heartbeat and an idle engine
  // are the CORRECT state there and say nothing whatsoever about production.
  // Read without that context, a healthy workspace looks exactly like a
  // production outage. So state the environment first, every time.
  const deployed = isDeployment();
  const devDb = config.database.isIsolatedDev;
  console.log(`  environment : ${deployed ? "deployment (the published app)" : "workspace (development shell)"}`);
  console.log(`  database    : ${devDb ? "the repl's built-in DEV database" : "DATABASE_URL"} → ${config.database.url ? dbTarget(config.database.url) : "(unset)"}`);
  console.log(`  worker here : ${config.worker.enabled ? "enabled" : `disabled (RUN_WORKER="${process.env.RUN_WORKER ?? ""}")`}`);
  console.log("=".repeat(52));

  // What the findings are ABOUT is decided by the database, not by which shell
  // this runs in: the heartbeat and the job history are rows, written by
  // whichever worker owns that database. So the dev database is the thing that
  // makes a report not-about-production -- being in the workspace is not.
  if (devDb) {
    check(
      "WARN",
      "This read the repl's built-in DEV database — these findings are not about production",
      "USE_REPLIT_DEV_DB is on, so none of this describes your live data. Nothing beats against the dev database, so an idle engine and a stale heartbeat are EXPECTED here and prove nothing either way. DATABASE_URL carries the live value in the workspace too, so to read production from right here (read-only): `USE_REPLIT_DEV_DB=false npm run doctor`."
    );
  } else if (!deployed) {
    check(
      "WARN",
      "Running from the workspace, but reading the LIVE database",
      "The findings below are about production data. Note the split: the `worker here` line describes THIS shell (which deliberately runs no worker), while the heartbeat and job history are read from the database and so do describe the deployed worker."
    );
  }

  // ---- 1. Database ----
  if (!config.database.url) {
    check("FAIL", "DATABASE_URL is not set", "Set DATABASE_URL in the deployment environment. Nothing works without it.");
    return finish();
  }
  if (!(await dbHealthy())) {
    check("FAIL", "Database is not reachable", "The DATABASE_URL is set but the server did not answer. Check the Neon/Postgres instance is awake and the URL is current.");
    return finish();
  }
  check("PASS", "Database reachable");

  // ---- 2. Signing secret (also the Gmail-token encryption key) ----
  if (config.auth.secretIsDefault) {
    check(
      "FAIL",
      "AUTH_SECRET is the public default",
      "Set a real AUTH_SECRET (64+ random hex). On the default, sessions are forgeable AND Gmail tokens cannot be decrypted, so every connected inbox reads as disconnected."
    );
  } else {
    check("PASS", "AUTH_SECRET is set to a real value");
  }

  // ---- 3. Master automation switch ----
  const paused = await isAutomationPaused().catch(() => false);
  if (paused) {
    check("FAIL", "Automation is PAUSED (master switch)", "Turn automation back on in Settings. While paused, the scheduler enqueues nothing and every send is refused — the single most common cause of a silent engine.");
  } else {
    check("PASS", "Automation is on");
  }

  // ---- 4. Required external credentials ----
  check(
    config.claude.enabled ? "PASS" : "FAIL",
    config.claude.enabled ? "Anthropic (AI) key present" : "ANTHROPIC_API_KEY missing",
    config.claude.enabled ? undefined : "Set ANTHROPIC_API_KEY and restart. Without it, discovery still runs but nothing gets scored, analysed, or drafted, so no email is ever written."
  );

  // ---- 5. Worker liveness (the process that runs every cron) ----
  //
  // RUN_WORKER is a foot-gun worth checking before the heartbeat, because a
  // false value produces the *same* symptom as a dead process: the worker
  // boots, disables its handlers and scheduler, stops the heartbeat, and idles.
  // And "false" is easy to hit by accident -- anything that is not 1/true/yes/on
  // reads as false, so `RUN_WORKER=0`, `False`, `no`, or a typo all disable the
  // engine silently.
  const runWorkerRaw = process.env.RUN_WORKER;
  const runWorkerSet = runWorkerRaw != null && runWorkerRaw !== "";
  if (runWorkerSet && !config.worker.enabled && deployed) {
    check(
      "FAIL",
      `RUN_WORKER is set to "${runWorkerRaw}" in the deployment, which turns the engine off`,
      "The deployed instance runs NO jobs and NO scheduler, and stops its heartbeat, so it looks identical to a dead worker. Only 1/true/yes/on count as true, so `0`, `False` or a typo all read as off. Remove RUN_WORKER from the deployment's environment (the default is on) and redeploy."
    );
  }

  const beat = await readWorkerHeartbeat().catch(() => null);
  const beatAge = minutesSince(beat?.updatedAt);
  if (!beat || beatAge == null) {
    check("FAIL", "The background worker has never checked in", "The worker process is not running. On Replit this must be a Reserved VM deployment (an Autoscale deployment sleeps and stops all background work). Confirm `npm run start` launches web AND worker.");
  } else if (beatAge > 5) {
    // A stale beat still carries the evidence for *why*, and throwing it away
    // costs a diagnosis: the phase says whether the worker died mid-boot or
    // long after a healthy one, and the instance/boot time say whether a
    // restart has actually produced a new process. A heartbeat frozen at the
    // same instance across a redeploy means the worker is not being launched
    // at all -- which no amount of restarting will fix.
    const stalled = (beat.phase ?? null) !== READY_PHASE;
    // Against the dev database this is the expected reading, not a fault:
    // nothing beats to it. Reporting it as a blocker sends someone to restart
    // a production deployment that may be perfectly healthy.
    check(
      devDb ? "WARN" : "FAIL",
      `The worker last checked in ${Math.round(beatAge)} min ago (stale)` +
        (devDb ? " — expected against the dev database, which no worker beats to" : ""),
      (beat.detail ? `The worker's own last words: "${beat.detail}". ` : "") +
        `Last beat: phase "${beat.phase}", instance ${beat.instanceId}, booted ${isoOrRaw(beat.bootedAt)}. ` +
        (stalled
          ? `It never finished starting -- it stopped during "${beat.phase}", so look for that step in the deployment log.`
          : "It booted cleanly and then stopped, so look for a crash in the deployment log.") +
        " Redeploy, then run this again: if the instance and boot time above are UNCHANGED, no new worker process ever started — check that the deployment's run command is `npm run start` (not a web-only command) and that RUN_WORKER is not set."
    );
  } else if ((beat.phase ?? null) !== READY_PHASE) {
    // Alive but not ready has two very different causes, and they need
    // opposite fixes: a process HUNG on one step, or a process crash-LOOPING
    // so fast that a fresh first beat is always in the table. The row says
    // which -- a loop gets a new instance id every restart -- so sample it
    // twice rather than leave the operator to guess.
    console.log(`\n  Worker is alive but not ready (phase: ${beat.phase}). Sampling again in 6s to tell a hang from a crash-loop...`);
    await new Promise((r) => setTimeout(r, 6_000));
    const again = await readWorkerHeartbeat().catch(() => null);
    const looping = again != null && again.instanceId !== beat.instanceId;
    // Compare by instant, not by reference: pg hands back timestamptz as a Date
    // object, so two reads of an UNCHANGED row are still two distinct objects
    // and `!==` is true every time -- which reports a dead worker as merely
    // hung, the one pair this sampling exists to tell apart.
    const beatMoved =
      again != null &&
      new Date(again.updatedAt).getTime() !== new Date(beat.updatedAt).getTime();

    if (looping) {
      check(
        "FAIL",
        `The worker is CRASH-LOOPING at boot (phase: ${beat.phase})`,
        `${beat.detail ? `The worker's own last words: "${beat.detail}". ` : ""}Two different instances in six seconds (${beat.instanceId} → ${again!.instanceId}), each getting as far as "${beat.phase}" and dying. It is being restarted every few seconds, so no job ever runs. Restarting the deployment will NOT help — the next boot dies the same way. Open the deployment log and read the lines right after "[worker] database: reachable"; a crash prints "[worker] fatal:" with the reason.`
      );
    } else if (!beatMoved) {
      check(
        "FAIL",
        `The worker is stuck starting and its heartbeat has stopped (phase: ${beat.phase})`,
        `${beat.detail ? `The worker's own last words: "${beat.detail}". ` : ""}Instance ${beat.instanceId}, booted ${isoOrRaw(beat.bootedAt)}. The beat did not advance over six seconds, so the process is gone or wedged rather than looping. Restart the deployment and watch the log from "[worker] database: reachable" onward.`
      );
    } else {
      check(
        "FAIL",
        `The worker is HUNG on one boot step (phase: ${beat.phase})`,
        `Instance ${beat.instanceId} is still beating (so the process is alive) but has not left "${beat.phase}" — it is blocked inside that step, not crashing. Boot steps are bounded and will time out on their own; if it does not clear, the deployment log will name the step.`
      );
    }
  } else {
    check("PASS", `Worker alive and ready (beat ${Math.round(beatAge)} min ago)`);
  }

  // Migrations are the first thing the worker does after the database check,
  // so when a boot dies at that point this is the evidence for which file it
  // died on. Read-only: it reports, it never applies anything.
  try {
    const files = readdirSync(join(process.cwd(), "db", "migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const applied = await query<{ name: string }>(`select name from _migrations order by name`);
    const appliedNames = new Set(applied.map((r) => r.name));
    const pending = files.filter((f) => !appliedNames.has(f));
    if (pending.length === 0) {
      check("PASS", `All ${files.length} migrations are applied`);
    } else {
      check(
        "WARN",
        `${pending.length} migration(s) are not applied`,
        `Next pending: ${pending[0]}. The worker applies these at boot, right after the database check — so if the worker is stuck or looping at that point above, this is very likely the file it is dying on. Applying it by hand (\`npm run db:migrate\`) will show the actual error.`
      );
    }
  } catch {
    // No _migrations table, or the directory is not beside this process. Not
    // worth a finding: it only means this check cannot speak, not that
    // anything is wrong.
  }

  // ---- 6. Scheduler is actually enqueuing (job history) ----
  const lastRun = await queryOne<{ started_at: string | null }>(
    `select max(started_at) as started_at from job_runs`
  ).catch(() => null);
  const runAge = hoursSince(lastRun?.started_at);
  if (runAge == null) {
    check("WARN", "No job has ever run", "Expected once the worker is up. If the worker shows ready above but this stays empty, the scheduler is not enqueuing.");
  } else if (runAge > 3) {
    check("WARN", `No job has run in ${Math.round(runAge)}h`, "Sweeps run every 10–20 min, so hours of silence means the scheduler stopped. Check the worker above and the Automation Log.");
  } else {
    check("PASS", `Jobs are running (most recent ${Math.round(runAge * 60)} min ago)`);
  }

  console.log(`\n  ${scheduledAgents().length} agents are on a schedule (discovery every 3h, follow-ups every 15m, reply-poll every 15m).`);

  // ---- 7. The organizations the agents actually work for ----
  //
  // Ask the worker's own selector rather than re-deriving the rule. A
  // status-only filter is wrong in BOTH directions and this report had it:
  //
  //   * it misses a comped organization, whose subscription_status reads
  //     'canceled' by design and which the agents still work for. That is the
  //     exact bug listActiveOrganizations() was written to end -- "access said
  //     yes, the worker said no" -- and repeating it here reported a healthy
  //     account as the cause of an outage.
  //   * it counts a 'trial' whose date has passed, which the worker drops.
  //
  // Calling the function makes the two incapable of disagreeing again.
  const orgs = await listActiveOrganizations().catch(() => []);
  if (orgs.length === 0) {
    check("FAIL", "No organization is eligible for automation", "The agents work per organization and none qualifies: every account is suspended, lapsed, or cancelled without a comp. Nothing will run until one is active, comped, or on a live trial.");
    return finish();
  }
  // Leaked test fixtures are not customers, and reporting them per-org buries
  // the real ones: eight fixtures produce thirty-odd findings about missing
  // keys and inboxes they were never meant to have. Name them once, with the
  // command that removes them, and audit only the real orgs below.
  const leaked = orgs.filter((o) => looksLikeTestOrg(o.name));
  const realOrgs = orgs.filter((o) => !looksLikeTestOrg(o.name));
  check("PASS", `${orgs.length} organization(s) the agents will work for`);
  if (leaked.length > 0) {
    check(
      "WARN",
      `${leaked.length} of those are leaked test fixtures, not customers`,
      "They are counted as active, so the per-org agents loop over them every cycle. Remove them with `npm run purge-test-orgs` (dry run first), then `npm run purge-test-orgs -- --delete`. They are excluded from the per-org checks below."
    );
    for (const o of leaked.slice(0, 10)) console.log(`\n  ── (skipped, test fixture) ${o.name}`);
    if (leaked.length > 10) console.log(`\n  ── …and ${leaked.length - 10} more test fixtures`);
  }
  // A prefix list cannot keep up with the suite, so say when something looks
  // generated but is not matched. "Doomed Org <tag>" reached production and was
  // audited here as a real customer for exactly this reason. Reported, never
  // acted on: the purge still needs two signals.
  const nearMisses = realOrgs.filter((o) => hasGeneratedTag(o.name));
  if (nearMisses.length > 0) {
    check(
      "WARN",
      `${nearMisses.length} organization(s) end in a generated tag but match no known fixture name`,
      `Audited below as real customers, which they are probably not: ${nearMisses
        .slice(0, 8)
        .map((o) => o.name)
        .join(", ")}${nearMisses.length > 8 ? ", …" : ""}. No real company name ends in a random hex tag. If these are fixtures, add their prefix to lib/domain/test-org-match.ts so the purge can see them; the purge will not touch them until you do.`
    );
  }

  // Automation only runs for active/trial orgs, so a real account whose
  // subscription has lapsed goes completely silent while everything here still
  // reads healthy: it is not failing, it is absent, because the query above
  // only ever selected active orgs.
  //
  // This has to be read BEFORE the early return below. "No real active
  // organizations" is precisely the moment the next question is "then where IS
  // the account?", and returning first left that unanswered.
  //
  // The complement of the set above, by id rather than by re-testing the rule,
  // so the two halves cannot drift apart the way the old status filter did.
  // Each one says WHY it is excluded, because "canceled" alone is not a reason
  // -- a canceled organization that is comped is worked for regardless.
  const everyOrg = await query<{
    id: string;
    name: string;
    subscription_status: string | null;
    billing_exempt: boolean | null;
    suspended_at: string | Date | null;
    trial_ends_at: string | Date | null;
  }>(
    `select id, name, subscription_status, billing_exempt, suspended_at, trial_ends_at
       from organizations order by created_at`
  ).catch(() => []);
  const workedIds = new Set(orgs.map((o) => o.id));
  const excludedReason = (o: (typeof everyOrg)[number]): string => {
    if (o.suspended_at) return "suspended";
    if (o.subscription_status === "trial") return "trial expired";
    return o.subscription_status ?? "no status";
  };
  const realInactive = everyOrg
    .filter((o) => !workedIds.has(o.id) && !looksLikeTestOrg(o.name))
    .map((o) => ({ name: o.name, subscription_status: excludedReason(o) }));
  const listInactive = (n: number) =>
    realInactive
      .slice(0, n)
      .map((o) => `${o.name} (${o.subscription_status})`)
      .join(", ") + (realInactive.length > n ? ", …" : "");
  if (realInactive.length > 0) {
    check(
      "WARN",
      `${realInactive.length} real organization(s) the agents will NOT work for`,
      `No automation runs for them at all — no discovery, no outreach, no follow-ups: ${listInactive(8)}. To bring one back, comp it (Admin → Accounts → the account → "Comp this account"), restart its trial, or put it on a paid plan. Note a comped account works even while its Stripe status reads cancelled, so the status alone is not the thing to fix.`
    );
  }

  if (realOrgs.length === 0) {
    check(
      "FAIL",
      "No real organization is eligible for automation",
      realInactive.length > 0
        ? `Every eligible organization is a leaked test fixture, and no real account qualifies: ${listInactive(
            12
          )}. Nothing runs for them, which is very likely why the engine is silent. Comp the account (Admin → Accounts → the account → "Comp this account"), restart its trial, or put it on a paid plan.`
        : "Every eligible organization is a leaked test fixture, and no real organization exists in any other state either. Confirm this is the right database, then purge the fixtures."
    );
    return finish();
  }

  // ---- 8. Per-org discovery + outreach readiness ----
  for (const org of realOrgs) {
    console.log(`\n  ── ${org.name} (${org.subscription_status}) ──`);

    const hasSam = await orgHasKey("SAM_API_KEY", org.id).catch(() => false);
    if (!hasSam) {
      check("FAIL", `[${org.name}] No SAM.gov API key`, "Add the SAM key in Settings → Integrations. Without it, no federal opportunities are ever pulled — this alone stops all deal discovery.");
    } else {
      check("PASS", `[${org.name}] SAM.gov key present`);
    }

    const monitor = await queryOne<{ ok: string | null; err: string | null }>(
      `select (select max(started_at) from job_runs where agent='opportunity-monitor' and status='ok') as ok,
              (select message from agent_logs where agent='opportunity-monitor' and action='poll-sam'
                 and level='error' and org_id=$1 and created_at > now() - interval '6 hours'
               order by created_at desc limit 1) as err`,
      [org.id]
    ).catch(() => null);
    if (monitor?.err) {
      check("FAIL", `[${org.name}] SAM.gov requests are failing`, `Last error: ${monitor.err.slice(0, 140)}. Test the key in Settings → Integrations.`);
    }
    const discovered = await queryOne<{ n: number }>(
      `select count(*)::int as n from opportunities where org_id=$1 and created_at > now() - interval '7 days'`,
      [org.id]
    ).catch(() => null);
    check(
      (discovered?.n ?? 0) > 0 ? "PASS" : "WARN",
      `[${org.name}] ${discovered?.n ?? 0} opportunities discovered in the last 7 days`,
      (discovered?.n ?? 0) > 0 ? undefined : "If this is zero with a working SAM key, the org's discovery filters (NAICS/state/keywords) may match nothing, or the monitor has not run. Run it now from the Agents page."
    );

    const conn = await gmail.connection(org.id).catch(() => ({ connected: false, status: "none", lastError: null as string | null }));
    if (!conn.connected || conn.status === "revoked") {
      check("FAIL", `[${org.name}] Google inbox not connected (${conn.status})`, "Connect/reconnect the Google inbox in Settings → Integrations. Without it every outreach and follow-up is held as a draft and nothing is emailed.");
    } else if (conn.status === "error") {
      check("WARN", `[${org.name}] Google inbox connected but recently errored`, conn.lastError ? `Last error: ${conn.lastError.slice(0, 140)}` : "Recent sends failed; watch the next runs.");
    } else {
      check("PASS", `[${org.name}] Google inbox connected`);
    }

    const sent = await queryOne<{ n: number }>(
      `select count(*)::int as n from communications
        where org_id=$1 and direction='outbound' and channel='email'
          and created_at > now() - interval '7 days'`,
      [org.id]
    ).catch(() => null);
    check(
      (sent?.n ?? 0) > 0 ? "PASS" : "WARN",
      `[${org.name}] ${sent?.n ?? 0} outreach emails sent in the last 7 days`,
      (sent?.n ?? 0) > 0 ? undefined : "Zero usually chains from a failure above (no discovery, no inbox, or automation paused). Fix those first."
    );
  }

  finish();
}

function finish() {
  console.log("\n" + "=".repeat(52));
  const icon = { PASS: "✓", WARN: "!", FAIL: "✗" } as const;
  for (const r of results) {
    console.log(`  ${icon[r.status]} ${r.status.padEnd(4)} ${r.title}`);
    if (r.fix) console.log(`         → ${r.fix}`);
  }
  const fails = results.filter((r) => r.status === "FAIL").length;
  const warns = results.filter((r) => r.status === "WARN").length;
  console.log("\n" + "=".repeat(52));
  if (fails > 0) {
    console.log(`  ${fails} blocking problem(s) found. Fix the FAILs above, top to bottom — the first one often causes the rest.`);
  } else if (warns > 0) {
    console.log(`  No blockers. ${warns} warning(s) worth a look.`);
  } else {
    console.log("  Everything the doctor can see is healthy. The engine should be finding deals and sending email.");
  }
  process.exit(fails > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\ndoctor crashed:", err instanceof Error ? err.message : err);
  process.exit(2);
});
