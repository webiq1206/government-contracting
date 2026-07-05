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

  if (!(await dbHealthy())) {
    console.error("[worker] DATABASE_URL not reachable. Set it and run `npm run db:setup`. Exiting.");
    process.exit(1);
  }

  const server = startHealthServer();

  // RUN_WORKER=false → this instance does NOT process jobs or run the scheduler.
  // Set it on web-only instances so exactly one dedicated instance runs cron
  // (prevents every autoscale instance from double-enqueuing scheduled jobs).
  // Default is true, so a single-instance deploy is unchanged.
  if (!config.worker.enabled) {
    console.log("[worker] RUN_WORKER=false — job handlers + scheduler disabled; health only.");
    process.on("SIGTERM", () => process.exit(0));
    process.on("SIGINT", () => process.exit(0));
    console.log("[worker] ready (idle)");
    return;
  }

  const queue = await getQueue();

  // Register a handler for every agent + maintenance job.
  for (const def of ALL_AGENTS) {
    await queue.work(def.name, async (payload) => {
      await runAgent(def, "queue", payload as Record<string, unknown>);
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
