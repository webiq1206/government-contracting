/**
 * pg-boss backend (default). Uses the same Postgres database as the app; creates
 * its own `pgboss` schema. No Redis required.
 */
import PgBoss from "pg-boss";
import { config } from "../config";
import type { EnqueueOptions, JobHandler, JobPayload, Queue } from "./index";
import { QUEUE_NAMES } from "./index";

export async function createPgBossQueue(): Promise<Queue> {
  const boss = new PgBoss({
    connectionString: config.database.url,
    ssl: config.database.url.includes("localhost")
      ? undefined
      : { rejectUnauthorized: false },
    // Keep completed job rows briefly for the dashboard, then archive.
    retentionDays: 7,
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

    async stop() {
      started = false;
      await boss.stop({ graceful: true }).catch(() => {});
    },
  };
}
