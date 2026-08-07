/**
 * Worker entrypoint. Boots the queue, registers a handler per agent (each runs
 * through the isolating runner), starts the cron scheduler, and exposes a tiny
 * health endpoint so the host (Replit/Railway) can health-check the worker.
 *
 *   npm run worker      # standalone
 *   npm run start       # web + worker together (concurrently)
 */
import "../lib/env";
import http from "node:http";
import { config } from "../lib/config";
import { dbHealthy } from "../lib/db";
import { getQueue, stopQueue } from "../lib/queue";
import { applyMigrations } from "../lib/migrate";
import { ensureOperatorFromEnv } from "../lib/operator-bootstrap";
import { hydrateIntegrationEnv } from "../lib/integration-settings";
import { ALL_AGENTS } from "../lib/agents/registry";
import { runAgent } from "../lib/agents/runner";
import { startScheduler } from "./scheduler";
import { closeScraperBrowser } from "../lib/integrations/scrapers";

async function main() {
  console.log("=".repeat(60));
  console.log("BROSTCO worker starting");
  console.log(`  env=${config.env} queue=${config.queue.backend}`);
  console.log(`  claude=${config.claude.enabled ? "on" : "off"} sam=${config.sam.enabled ? "on" : "off"} gmail=${config.gmail.configured ? "on" : "off"}`);
  console.log("=".repeat(60));

  // Retry dbHealthy with backoff instead of instant-exit. On cold-start under
  // `concurrently` (web + worker together), an instant worker exit can kill the
  // web process before the platform's health check has a chance to succeed, and
  // the whole deploy fails Promote. Retry for ~60s; the DB is usually reachable
  // within a few seconds, and this bounds waiting so a real config problem still
  // surfaces.
  const server = startHealthServer();
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

  // Apply any pending schema migrations before handlers start. Idempotent,
  // advisory-locked, and non-fatal: on failure the worker still boots so the
  // web app keeps serving with the previous schema.
  try {
    await applyMigrations();
  } catch (err) {
    console.error("[worker] migration failed (continuing with existing schema):", (err as Error).message);
  }

  // Ensure the owner's operator login exists (from OPERATOR_EMAIL/OPERATOR_PASSWORD secrets).
  await ensureOperatorFromEnv();

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
    process.on("SIGTERM", () => process.exit(0));
    process.on("SIGINT", () => process.exit(0));
    console.log("[worker] ready (idle)");
    return;
  }

  const queue = await getQueue();

  // Register a handler for every agent + maintenance job.
  for (const def of ALL_AGENTS) {
    await queue.work(def.name, async (payload) => {
      const result = await runAgent(def, "queue", payload as Record<string, unknown>);
      // The runner isolates errors (logs + returns ok:false) so one agent can
      // never crash another. But swallowing the error here too would tell
      // pg-boss the job SUCCEEDED, its retryLimit/backoff would never fire,
      // and a single transient failure (Claude 429, DB blip) would strand the
      // record forever: nothing ever re-enqueues a consumed job. Rethrow so
      // the queue retries; the runner has already logged the details.
      if (!result.ok) throw new Error(result.summary);
    });
  }
  console.log(`[worker] registered ${ALL_AGENTS.length} handlers`);

  const stopScheduler = startScheduler();

  async function shutdown(signal: string) {
    console.log(`[worker] ${signal} received, shutting down...`);
    stopScheduler();
    server.close();
    await stopQueue().catch(() => {});
    await closeScraperBrowser().catch(() => {});
    process.exit(0);
  }
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  console.log("[worker] ready");
}

/** Tiny health endpoint (separate port from the web app). */
function startHealthServer(): http.Server {
  const port = Number(process.env.WORKER_PORT ?? 3100);
  const server = http.createServer(async (req, res) => {
    if (req.url === "/health" || req.url === "/") {
      const healthy = await dbHealthy();
      res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: healthy, service: "brostco-worker", queue: config.queue.backend }));
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
