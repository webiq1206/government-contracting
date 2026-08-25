/**
 * pg-boss backend (default). Uses the same Postgres database as the app; creates
 * its own `pgboss` schema. No Redis required.
 */
import PgBoss from "pg-boss";
import { config, pgSslFor } from "../config";
import type { EnqueueOptions, JobHandler, JobPayload, Queue } from "./index";
import { QUEUE_NAMES } from "./index";

export async function createPgBossQueue(): Promise<Queue> {
  const boss = new PgBoss({
    connectionString: config.database.url,
    ssl: pgSslFor(config.database.url),
    // Keep completed job rows briefly for the dashboard, then archive.
    retentionDays: 7,
    /**
     * pg-boss opens a pool of its own, entirely separate from lib/db's. Left at
     * its default that is a second double-figure pool from the same process,
     * on top of the app pool here and another in the web process — and a
     * managed Postgres answers a connection request it cannot serve by making
     * the caller wait, not by failing fast. The worker that starves in that
     * wait is the one holding the heartbeat, so the symptom is a silent engine
     * rather than an error.
     *
     * Four is plenty for a queue polling on a timer, and leaves room for the
     * app pool beside it. Tunable for a bigger deployment without a change
     * here.
     */
    max: Number(process.env.PGBOSS_POOL_MAX ?? 4),
    /** So these connections are identifiable in the database's own view. */
    application_name: "brostco-pgboss",
  });
  boss.on("error", (e) => console.error("[pg-boss]", e.message));

  let started = false;

  return {
    async start() {
      if (started) return;
      await boss.start();
      // pg-boss v10 requires queues to exist before send/work.
      for (const name of QUEUE_NAMES) {
        await boss.createQueue(name).catch(() => {});
      }
      started = true;
    },

    async enqueue(name: string, payload: JobPayload, opts?: EnqueueOptions) {
      // pg-boss v10 silently DROPS a send to a queue that was never created
      // (returns null). That is how agents missing from QUEUE_NAMES ended up
      // never running at all, with no error anywhere. Creating the queue here
      // is idempotent and cheap, so a name that drifts out of the list can
      // never again fail silently.
      await boss.createQueue(name).catch(() => {});
      const sendOpts: PgBoss.SendOptions = {
        retryLimit: 3,
        retryDelay: 30,
        retryBackoff: true,
        expireInMinutes: 30,
      };
      if (opts?.startAfterSeconds) sendOpts.startAfter = opts.startAfterSeconds;
      if (opts?.priority) sendOpts.priority = opts.priority;
      if (opts?.singletonKey) {
        sendOpts.singletonKey = opts.singletonKey;
        // Pair the key with a time window so dedupe holds across instances even
        // after the (fast) job completes, otherwise a second worker ticking the
        // same minute re-enqueues once the first is no longer "active".
        sendOpts.singletonSeconds = opts.singletonSeconds ?? 55;
      }
      return boss.send(name, payload, sendOpts);
    },

    async work(name: string, handler: JobHandler) {
      await boss.work<JobPayload>(name, { batchSize: 1 }, async (jobs) => {
        // v10 delivers an array; batchSize 1 keeps it to a single job.
        for (const job of jobs) {
          await handler(job.data);
        }
      });
    },

    /**
     * Ask the running boss instance itself, not the database in general. A
     * plain "select 1" would answer yes while pg-boss sat stopped and no job
     * was being picked up, which is exactly the state that looked healthy for
     * an entire night.
     */
    async healthy() {
      if (!started) return false;
      try {
        await boss.getQueueSize(QUEUE_NAMES[0]);
        return true;
      } catch (err) {
        console.error("[pg-boss] health probe failed:", (err as Error).message);
        return false;
      }
    },

    async stop() {
      started = false;
      await boss.stop({ graceful: true }).catch(() => {});
    },
  };
}
