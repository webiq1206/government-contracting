/**
 * BullMQ backend (optional). Activated when REDIS_URL is set. A single "agents"
 * queue is used; the job name selects the agent handler. bullmq + ioredis are
 * optionalDependencies, so this module is only imported when REDIS_URL exists.
 */
import { config } from "../config";
import { createHash } from "node:crypto";
import { withTimeout } from "../boot-step";
import type { EnqueueOptions, JobHandler, JobPayload, Queue } from "./index";

export async function createBullQueue(): Promise<Queue> {
  const { Queue: BullQueue, Worker } = await import("bullmq");
  const IORedis = (await import("ioredis")).default;
  type Conn = ConstructorParameters<typeof BullQueue>[1] extends { connection?: infer C }
    ? C
    : never;

  const connection = new IORedis(config.queue.redisUrl, {
    // Interactive producers must report an outage instead of accumulating
    // commands indefinitely. Consumers get their own retrying connection.
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 10_000,
  });
  // ioredis is a peer of bullmq; the nested-copy type hazard is cosmetic, the
  // runtime instance is fully compatible. Cast through the expected shape.
  const conn = connection as unknown as Conn;
  const queue = new BullQueue("agents", { connection: conn });
  queue.on("error", (err) => console.error("[bullmq] producer error:", err.message));
  const handlers = new Map<string, JobHandler>();
  let worker: import("bullmq").Worker | null = null;
  let consumerConnection: InstanceType<typeof IORedis> | null = null;
  let started = false;

  return {
    async start() {
      try {
        await withTimeout(queue.waitUntilReady(), 20_000, "Redis queue startup");
      } catch (error) {
        connection.disconnect();
        throw error;
      }
      started = true;
    },

    async activate() {
      if (worker) return;
      if (!started || handlers.size === 0) throw new Error("Register queue handlers before starting the consumer.");
      consumerConnection = connection.duplicate({ maxRetriesPerRequest: null, enableOfflineQueue: true });
      worker = new Worker(
        "agents",
        async (job) => {
          const handler = handlers.get(job.name);
          if (!handler) throw new Error(`no handler registered for ${job.name}`);
          await handler(job.data as JobPayload);
        },
        { connection: consumerConnection as unknown as Conn, concurrency: 4 }
      );
      worker.on("error", (err) => console.error("[bullmq] consumer error:", err.message));
      worker.on("failed", (job, err) =>
        console.error(`[bullmq] ${job?.name} failed:`, err.message)
      );
      await worker.waitUntilReady();
    },

    async enqueue(name: string, payload: JobPayload, opts?: EnqueueOptions) {
      const job = await queue.add(name, payload, {
        attempts: 3,
        backoff: { type: "exponential", delay: 30_000 },
        delay: opts?.startAfterSeconds ? opts.startAfterSeconds * 1000 : undefined,
        priority: opts?.priority,
        // The shared Redis queue needs the agent and tenant in its identity.
        // Caller keys often contain colons, which BullMQ rejects as job IDs.
        jobId: opts?.singletonKey
          ? createHash("sha256").update(JSON.stringify([name, payload.enqueuedByOrgId ?? null, opts.singletonKey])).digest("hex")
          : undefined,
        removeOnComplete: 500,
        removeOnFail: 1000,
      });
      return job.id ?? null;
    },

    async work(name: string, handler: JobHandler) {
      handlers.set(name, handler);
    },

    /**
     * Redis has to answer and any activated consumer must be running. A process that is up
     * with a dead Redis connection is not serving the queue, and reporting it
     * as healthy is how a silent outage lasts all night.
     */
    async healthy() {
      if (!started) return false;
      try {
        await connection.ping();
        // A producer can reach Redis without consuming work. Recovery also
        // checks the separate worker heartbeat before it declares readiness.
        return worker ? worker.isRunning() : true;
      } catch (err) {
        console.error("[bullmq] health probe failed:", (err as Error).message);
        return false;
      }
    },

    async stop() {
      started = false;
      try {
        await worker?.close();
      } finally {
        try { await queue.close(); }
        finally {
          consumerConnection?.disconnect();
          connection.disconnect();
          consumerConnection = null;
          worker = null;
        }
      }
    },
  };
}
