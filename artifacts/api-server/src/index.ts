import app from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "./lib/migrate";
import { runSeed } from "./engine/seed";
import { startEngine } from "./engine/worker";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

/**
 * Boot sequence: apply migrations (advisory-locked, idempotent) and seed the
 * Company Profile before serving, then start the autonomous engine (cron +
 * queue) unless RUN_WORKER=false. Migration/seed failures are fatal (the API is
 * useless without its schema); engine failures are logged but non-fatal so the
 * API still serves.
 */
async function boot() {
  try {
    const { applied } = await runMigrations();
    if (applied.length) logger.info({ applied }, "migrations applied");
    const { seeded } = await runSeed();
    if (seeded.length) logger.info({ seeded }, "seed applied");
  } catch (err) {
    logger.error({ err }, "fatal: migrations/seed failed");
    process.exit(1);
  }

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });

  // Start the autonomous engine after the server is up.
  startEngine().catch((err) => logger.error({ err }, "engine failed to start"));
}

void boot();

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  const { stopEngine } = await import("./engine/worker");
  await stopEngine().catch(() => {});
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
