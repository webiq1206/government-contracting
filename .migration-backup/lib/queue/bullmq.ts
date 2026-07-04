/**
 * BullMQ backend (optional). Activated when REDIS_URL is set. A single "agents"
 * queue is used; the job name selects the agent handler. bullmq + ioredis are
 * optionalDependencies, so this module is only imported when REDIS_URL exists.
 */
import { config } from "../config";
import type { EnqueueOptions, JobHandler, JobPayload, Queue } from "./index";

export async function createBullQueue(): Promise<Queue> {
  const { Queue: BullQueue, Worker } = await import("bullmq");
  const IORedis = (await import("ioredis")).default;
  type Conn = ConstructorParameters<typeof BullQueue>[1] extends { connection?: infer C }
    ? C
    : never;

  const connection = new IORedis(config.queue.redisUrl, {
    maxRetriesPerRequest: null,
  });
  // ioredis is a peer of bullmq; the nested-copy type hazard is cosmetic — the
  // runtime instance is fully compatible. Cast through the expected shape.
  const conn = connection as unknown as Conn;
  const queue = new BullQueue("agents", { connection: conn });
  const handlers = new Map<string, JobHandler>();
  let worker: import("bullmq").Worker | null = null;

  return {
    async start() {
      if (worker) return;
      worker = new Worker(
        "agents",
        async (job) => {
          const handler = handlers.get(job.name);
          if (!handler) throw new Error(`no handler registered for ${job.name}`);
          await handler(job.data as JobPayload);
        },
        { connection: conn, concurrency: 4 }
      );
      worker.on("failed", (job, err) =>
        console.error(`[bullmq] ${job?.name} failed:`, err.message)
      );
    },

    async enqueue(name: string, payload: JobPayload, opts?: EnqueueOptions) {
      const job = await queue.add(name, payload, {
        attempts: 3,
        backoff: { type: "exponential", delay: 30_000 },
        delay: opts?.startAfterSeconds ? opts.startAfterSeconds * 1000 : undefined,
        priority: opts?.priority,
        jobId: opts?.singletonKey,
        removeOnComplete: 500,
        removeOnFail: 1000,
      });
      return job.id ?? null;
    },

    async work(name: string, handler: JobHandler) {
      handlers.set(name, handler);
    },

    async stop() {
      await worker?.close();
      await queue.close();
      await connection.quit();
      worker = null;
    },
  };
}
