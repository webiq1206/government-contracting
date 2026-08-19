/**
 * Worker entrypoint. Boots the queue, registers a handler per agent (each runs
 * through the isolating runner), starts the cron scheduler, and exposes a tiny
 * health endpoint so the host (Replit/Railway) can health-check the worker.
 *
 *   npm run worker      # standalone
 *   npm run start       # web + worker together (concurrently)
 *
 * Boot is written to be watched, not guessed at. A deploy once got as far as
 * the migration step and then produced nothing at all for eight hours: the
 * process was alive, the web half kept serving, and no job ever ran. There was
 * no crash to find, because there was no crash, one `await` simply never came
 * back. So now every step announces itself, is bounded by a timeout, reports
 * how long it took, and writes its name into the heartbeat the dashboard
 * reads. A stall is loud, and the connection to the queue, the one thing
 * without which this process is pointless, is retried until it works instead
 * of being awaited once and hoped for.
 */
import "../lib/env";
import http from "node:http";
import { config } from "../lib/config";
import { dbHealthy } from "../lib/db";
import { getQueue, resetQueue, stopQueue } from "../lib/queue";
import { applyMigrations } from "../lib/migrate";
import { ensureOperatorFromEnv } from "../lib/operator-bootstrap";
import { hydrateIntegrationEnv } from "../lib/integration-settings";
import { ALL_AGENTS } from "../lib/agents/registry";
import { runAgent, shouldQueueRetry } from "../lib/agents/runner";
import { startScheduler } from "./scheduler";
import { closeScraperBrowser } from "../lib/integrations/scrapers";
import { bootStep, retryForever, withTimeout } from "../lib/boot-step";
import {
  DEGRADED_PHASE,
  INSTANCE_ID,
  READY_PHASE,
  closeInterruptedRuns,
  startHeartbeat,
} from "../lib/worker-heartbeat";

/**
 * Ceilings, not expectations. Each of these normally takes under a second; the
 * numbers are set where "this is not coming back" becomes the better guess.
 */
const STEP_TIMEOUTS = {
  migrations: 15 * 60_000,
  operator: 60_000,
  recovery: 60_000,
  queue: 2 * 60_000,
  handlers: 2 * 60_000,
} as const;

/** What the heartbeat reports right now. Read on every beat, not captured. */
let phase = "starting";

function step<T>(name: string, timeoutMs: number, fn: () => Promise<T>): Promise<T> {
  return bootStep(name, fn, { timeoutMs, onPhase: (p) => (phase = p) });
}

async function main() {
  console.log("=".repeat(60));
  console.log("BROSTCO worker starting");
  console.log(`  env=${config.env} queue=${config.queue.backend} instance=${INSTANCE_ID}`);
  console.log(`  claude=${config.claude.enabled ? "on" : "off"} sam=${config.sam.enabled ? "on" : "off"} gmail=${config.gmail.configured ? "on" : "off"}`);
  console.log("=".repeat(60));

  // Retry dbHealthy with backoff instead of instant-exit. On cold-start under
  // `concurrently` (web + worker together), an instant worker exit can kill the
  // web process before the platform's health check has a chance to succeed, and
  // the whole deploy fails Promote. Retry for ~60s; the DB is usually reachable
  // within a few seconds, and this bounds waiting so a real config problem still
  // surfaces.
  const server = startHealthServer();
  phase = "database";
  let dbUp = false;
  for (let attempt = 1; attempt <= 12; attempt++) {
    if (await dbHealthy()) {
      dbUp = true;
      break;
    }
    console.warn(`[worker] DATABASE_URL not reachable (attempt ${attempt}/12); retrying in 5s...`);
    await new Promise((r) => setTimeout(r, 5_000));
  }
  if (!dbUp) {
    // Keep the health server up so the platform's health check can still pass
    // and the WEB process (running in parallel via concurrently) isn't collateral
    // damage. The health endpoint reports 503 while the DB is unreachable.
    console.error(
      "[worker] DATABASE_URL still unreachable after 60s. Handlers + scheduler disabled; health only."
    );
    process.on("SIGTERM", () => process.exit(0));
    process.on("SIGINT", () => process.exit(0));
    return;
  }
  console.log("[worker] database: reachable");

  // Beat before anything slow runs, migrations included. A boot that stalls in
  // the migration step is one of the states this is here to name, so waiting
  // until migrations finish would leave exactly that case invisible. On the
  // very first boot of the deploy that introduces the heartbeat table the write
  // fails until the migration creates it; that is logged once and then retried,
  // and until it lands the named boot log and the health endpoint are what
  // report the phase.
  const stopHeartbeat = startHeartbeat(() => phase);

  // Apply any pending schema migrations before handlers start. Idempotent,
  // advisory-locked, and non-fatal: on failure the worker still boots so the
  // web app keeps serving with the previous schema.
  try {
    await step("migrations", STEP_TIMEOUTS.migrations, () => applyMigrations());
  } catch (err) {
    console.error("[worker] continuing with the existing schema:", (err as Error).message);
  }

  // Ensure the owner's operator login exists (from OPERATOR_EMAIL/OPERATOR_PASSWORD secrets).
  // Never fatal: the app has other ways in, and a locked-out owner is not
  // improved by a worker that refuses to start.
  try {
    await step("operator-account", STEP_TIMEOUTS.operator, () => ensureOperatorFromEnv());
  } catch (err) {
    console.error("[worker] operator account check skipped:", (err as Error).message);
  }

  // Anything left mid-flight by the instance we are replacing.
  //
  // On a timer as well as at boot, because the grace period and the restart do
  // not line up: a run interrupted five minutes before the restart is younger
  // than the floor when this first runs, and closing it at boot alone would
  // leave it marked "running" until some later restart happened to fall more
  // than an hour after it. The sweep is a single cheap update.
  const sweepInterruptedRuns = async (context: string) => {
    try {
      const closed = await withTimeout(closeInterruptedRuns(), STEP_TIMEOUTS.recovery, "recover-interrupted-runs");
      if (closed > 0) console.log(`[worker] closed ${closed} run(s) interrupted by a restart (${context})`);
    } catch (err) {
      console.error("[worker] interrupted-run cleanup skipped:", (err as Error).message);
    }
  };
  await step("recover-interrupted-runs", STEP_TIMEOUTS.recovery, () => sweepInterruptedRuns("boot"));
  const recoveryTimer = setInterval(() => void sweepInterruptedRuns("sweep"), 15 * 60_000);
  recoveryTimer.unref?.();

  // Load UI-managed integration credentials into the environment, and keep
  // them fresh so a key saved on the Integrations page reaches agents without
  // a restart.
  await hydrateIntegrationEnv();
  const hydrateTimer = setInterval(() => void hydrateIntegrationEnv(), 5 * 60_000);
  hydrateTimer.unref?.();

  // RUN_WORKER=false → this instance does NOT process jobs or run the scheduler.
  // Set it on web-only instances so exactly one dedicated instance runs cron
  // (prevents every autoscale instance from double-enqueuing scheduled jobs).
  // Default is true, so a single-instance deploy is unchanged.
  if (!config.worker.enabled) {
    console.log("[worker] RUN_WORKER=false, job handlers + scheduler disabled; health only.");
    clearInterval(recoveryTimer);
    stopHeartbeat();
    process.on("SIGTERM", () => process.exit(0));
    process.on("SIGINT", () => process.exit(0));
    console.log("[worker] ready (idle)");
    return;
  }

  // The queue is not optional. Give up on it and this process is a health
  // endpoint with opinions, so keep attempting until it connects, dropping the
  // half-started backend between tries.
  const queue = await retryForever(
    "queue",
    () => step("queue", STEP_TIMEOUTS.queue, () => getQueue()),
    {
      baseDelayMs: 5_000,
      maxDelayMs: 60_000,
      onRetry: () => resetQueue(),
    }
  );

  // Register a handler for every agent + maintenance job.
  await step("handlers", STEP_TIMEOUTS.handlers, async () => {
    for (const def of ALL_AGENTS) {
      await queue.work(def.name, async (payload) => {
        const result = await runAgent(def, "queue", payload as Record<string, unknown>);
        // The runner isolates errors (logs + returns ok:false) so one agent can
        // never crash another. But swallowing the error here too would tell
        // pg-boss the job SUCCEEDED, its retryLimit/backoff would never fire,
        // and a single transient failure (Claude 429, DB blip) would strand the
        // record forever: nothing ever re-enqueues a consumed job. Rethrow so
        // the queue retries; the runner has already logged the details.
        //
        // Unless the runner has told us retrying is pointless, which it does
        // when the record the job was about has been deleted. Retrying that is
        // three more attempts at nothing.
        if (shouldQueueRetry(result)) throw new Error(result.summary);
      });
    }
  });
  console.log(`[worker] registered ${ALL_AGENTS.length} handlers`);

  const stopScheduler = startScheduler();

  async function shutdown(signal: string) {
    console.log(`[worker] ${signal} received, shutting down...`);
    phase = "stopping";
    clearInterval(healthTimer);
    clearInterval(recoveryTimer);
    stopHeartbeat();
    stopScheduler();
    server.close();
    await stopQueue().catch(() => {});
    await closeScraperBrowser().catch(() => {});
    process.exit(0);
  }
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  phase = READY_PHASE;
  console.log("[worker] ready");

  // "The process is alive" is not "the queue is being served". pg-boss can stop
  // or lose its connection long after boot while this process keeps checking in
  // perfectly happily, which is the same false all-clear in a later disguise.
  // Ask the backend itself on a timer and let the phase say so.
  // The probe is bounded and single-flight: an unbounded health check that
  // never returns is the very failure it is watching for, and a stack of
  // pending probes would hide it behind the last answer that did come back.
  let probing = false;
  const healthTimer = setInterval(() => {
    void (async () => {
      if (phase !== READY_PHASE && phase !== DEGRADED_PHASE) return;
      if (!queue.healthy) return; // backend offers no probe; leave the phase alone
      if (probing) return;
      probing = true;
      const ok = await withTimeout(queue.healthy(), 15_000, "queue-health")
        .catch(() => false)
        .finally(() => {
          probing = false;
        });
      if (!ok && phase === READY_PHASE) {
        console.error("[worker] the queue backend stopped answering; reporting degraded");
      } else if (ok && phase === DEGRADED_PHASE) {
        console.log("[worker] the queue backend is answering again");
      }
      phase = ok ? READY_PHASE : DEGRADED_PHASE;
    })();
  }, 60_000);
  healthTimer.unref?.();
}

/** Tiny health endpoint (separate port from the web app). */
function startHealthServer(): http.Server {
  const port = Number(process.env.WORKER_PORT ?? 3100);
  const server = http.createServer(async (req, res) => {
    if (req.url === "/health" || req.url === "/") {
      const healthy = await dbHealthy();
      // The phase is here so a stuck boot can be read from the outside without
      // waiting on the database round-trip the dashboard does.
      const ok = healthy && (phase === READY_PHASE || !config.worker.enabled);
      res.writeHead(ok ? 200 : 503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok,
          service: "brostco-worker",
          queue: config.queue.backend,
          db: healthy,
          phase,
          instance: INSTANCE_ID,
        })
      );
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(port, () => console.log(`[worker] health server on :${port}`));
  return server;
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
