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
import { config } from "../lib/config";
import { query, queryOne, dbHealthy } from "../lib/db";
import { readWorkerHeartbeat, READY_PHASE } from "../lib/worker-heartbeat";
import { isAutomationPaused } from "../lib/app-settings";
import { gmail } from "../lib/integrations/gmail";
import { orgHasKey } from "../lib/integration-keys";
import { scheduledAgents } from "../lib/agents/registry";

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

async function main() {
  console.log("\nBROSTCO doctor — why the engine may be quiet\n" + "=".repeat(52));

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
  const beat = await readWorkerHeartbeat().catch(() => null);
  const beatAge = minutesSince(beat?.updatedAt);
  if (!beat || beatAge == null) {
    check("FAIL", "The background worker has never checked in", "The worker process is not running. On Replit this must be a Reserved VM deployment (an Autoscale deployment sleeps and stops all background work). Confirm `npm run start` launches web AND worker.");
  } else if (beatAge > 5) {
    check("FAIL", `The worker last checked in ${Math.round(beatAge)} min ago (stale)`, "The worker has stopped beating. Restart the deployment; if it recurs, check the Automation Log for a crash on boot.");
  } else if ((beat.phase ?? null) !== READY_PHASE) {
    check("FAIL", `The worker is stuck starting (phase: ${beat.phase})`, "It is alive but never finished booting, so no job runs. It retries on its own; if it does not clear in a few minutes, restart the deployment.");
  } else {
    check("PASS", `Worker alive and ready (beat ${Math.round(beatAge)} min ago)`);
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

  // ---- 7. Active organizations ----
  const orgs = await query<{ id: string; name: string; subscription_status: string }>(
    `select id, name, subscription_status from organizations
      where subscription_status in ('active','trial') order by created_at`
  ).catch(() => []);
  if (orgs.length === 0) {
    check("FAIL", "No active organizations", "Automation runs per organization and none is active (every trial/subscription has lapsed). Nothing will run until at least one is active.");
    return finish();
  }
  check("PASS", `${orgs.length} active organization(s)`);

  // ---- 8. Per-org discovery + outreach readiness ----
  for (const org of orgs) {
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
