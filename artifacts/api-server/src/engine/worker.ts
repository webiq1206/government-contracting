/**
 * Engine bootstrap. Registers a queue handler for every agent (each runs through
 * the isolating runner) and starts the cron scheduler. Designed to run INSIDE
 * the api-server process (started from src/index.ts) or standalone.
 *
 * Autoscale-safe: cron ticks enqueue with a per-minute singletonKey, so even if
 * several api-server instances run the scheduler, each scheduled job is enqueued
 * once. Queue consumption across instances is normal fan-out.
 */
import { config } from "./config";
import { dbHealthy } from "./db";
import { getQueue, stopQueue } from "./queue";
import { ALL_AGENTS } from "./agents/registry";
import { runAgent } from "./agents/runner";
import { startScheduler } from "./scheduler";
import { closeScraperBrowser } from "./integrations/scrapers";

let stopScheduler: (() => void) | null = null;
let started = false;

export async function startEngine(): Promise<void> {
  if (started) return;
  if (!config.worker.enabled) {
    console.log("[engine] RUN_WORKER=false — engine not started on this instance.");
    return;
  }
  if (!(await dbHealthy())) {
    console.error("[engine] database not reachable — engine not started.");
    return;
  }

  const queue = await getQueue();
  for (const def of ALL_AGENTS) {
    await queue.work(def.name, async (payload) => {
      await runAgent(def, "queue", payload as Record<string, unknown>);
    });
  }
  stopScheduler = startScheduler();
  started = true;
  console.log(
    `[engine] started — ${ALL_AGENTS.length} agent handlers, queue=${config.queue.backend}, ` +
      `claude=${config.claude.enabled ? "on" : "off"} sam=${config.sam.enabled ? "on" : "off"}`
  );
}

export async function stopEngine(): Promise<void> {
  if (!started) return;
  stopScheduler?.();
  await stopQueue().catch(() => {});
  await closeScraperBrowser().catch(() => {});
  started = false;
}

// Standalone entry: `tsx src/engine/worker.ts`. Argv check is bundling-safe: when
// bundled into dist/index.mjs, argv[1] ends with index.mjs so this does NOT run
// (index.ts calls startEngine() explicitly instead).
if (process.argv[1]?.endsWith("worker.ts")) {
  startEngine()
    .then(() => console.log("[engine] ready (standalone)"))
    .catch((err) => {
      console.error("[engine] fatal:", err);
      process.exit(1);
    });
  const shutdown = async (sig: string) => {
    console.log(`[engine] ${sig} — shutting down`);
    await stopEngine();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
