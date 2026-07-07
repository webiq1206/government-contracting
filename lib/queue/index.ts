/**
 * Pluggable job queue. Default backend is pg-boss (Postgres-backed, no Redis,
 * runs on Replit out of the box). If REDIS_URL is set, BullMQ is used instead.
 *
 * The interface is intentionally tiny: enqueue a job by agent name, and register
 * a worker handler by agent name. Cron scheduling lives in worker/scheduler.ts
 * and simply enqueues jobs, so it is backend-agnostic.
 */
import { config } from "../config";

export type JobPayload = Record<string, unknown>;
export type JobHandler = (payload: JobPayload) => Promise<void>;

export interface EnqueueOptions {
  startAfterSeconds?: number;
  singletonKey?: string; // dedupe: at most one active job with this key
  singletonSeconds?: number; // dedupe window (pg-boss), hold the key this long
  priority?: number;
}

export interface Queue {
  start(): Promise<void>;
  enqueue(name: string, payload: JobPayload, opts?: EnqueueOptions): Promise<string | null>;
  work(name: string, handler: JobHandler): Promise<void>;
  stop(): Promise<void>;
}

let _queue: Queue | null = null;

export async function getQueue(): Promise<Queue> {
  if (_queue) return _queue;
  if (config.queue.backend === "bullmq") {
    const { createBullQueue } = await import("./bullmq");
    _queue = await createBullQueue();
  } else {
    const { createPgBossQueue } = await import("./pgboss");
    _queue = await createPgBossQueue();
  }
  await _queue.start();
  return _queue;
}

/** Enqueue from anywhere (API routes, agents) without owning the worker. */
export async function enqueue(
  name: string,
  payload: JobPayload = {},
  opts?: EnqueueOptions
): Promise<string | null> {
  const q = await getQueue();
  return q.enqueue(name, payload, opts);
}

export async function stopQueue(): Promise<void> {
  if (_queue) {
    await _queue.stop();
    _queue = null;
  }
}

/** All queue/job names. Keep in sync with the agent registry. */
export const QUEUE_NAMES = [
  "opportunity-monitor",
  "scoring-engine",
  "solicitation-analyst",
  "pricing-research",
  "sub-finder",
  "sub-verify",
  "outreach",
  "call-prep",
  "bid-builder",
  "compliance-auditor",
  "compliance-monitor",
  "learning-loop",
  "analytics-engine",
  "sources-sought-responder",
  // maintenance jobs
  "outreach-followup",
  "review-expiry-sweep",
  "reply-poll",
  "stalled-pipeline-sweep",
  "deadline-monitor",
  "log-retention-sweep",
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];
