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
  /**
   * The organization this work belongs to, for a caller that knows it while
   * the ambient context does not (the runner enqueueing an agent's downstream
   * work, outside the tenant context on purpose).
   *
   * It is an option rather than a payload field so that it cannot arrive from
   * a request body. The manual-run endpoint spreads whatever JSON it is given
   * into the payload, so a payload is caller-controlled and can never be
   * trusted to say which tenant anything belongs to.
   */
  orgId?: string;
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
  const { isAutomationPaused } = await import("../app-settings");
  if (await isAutomationPaused()) {
    console.warn(`[queue] enqueue skipped (automation paused): ${name}`);
    return null;
  }
  const q = await getQueue();
  return q.enqueue(name, await withEnqueuingOrg(payload, opts?.orgId), opts);
}

/**
 * Stamp the payload with the organization that queued the work.
 *
 * A job payload names records, and a record can be deleted while the job is
 * still in the queue. When that happens the runner has nothing left to resolve
 * the tenant from, so the line explaining why the job was abandoned would be
 * filed against no organization and the customer whose job it was would never
 * see it on their Automation Log.
 *
 * This is provenance, not an instruction: it says who queued the work, and the
 * runner only falls back to it when no named record answers the question. It
 * deliberately does not use the `orgId` key, which asserts the tenant outright
 * and would override the record the job is actually about.
 *
 * The queue owns this field completely. Whatever the caller put there is
 * discarded and replaced, because the manual-run endpoint spreads a request
 * body straight into the payload: a signed-in customer could otherwise name
 * another organization, and a job with no live record to correct it would run
 * and log in that organization's context.
 */
export const ENQUEUED_BY_ORG_KEY = "enqueuedByOrgId";

async function withEnqueuingOrg(
  payload: JobPayload,
  fromCaller?: string
): Promise<JobPayload> {
  const { [ENQUEUED_BY_ORG_KEY]: _discarded, ...rest } = payload;
  const { actingOrgId } = await import("../tenant-context");
  const orgId = fromCaller ?? (await actingOrgId());
  return orgId ? { ...rest, [ENQUEUED_BY_ORG_KEY]: orgId } : rest;
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
  "backlink-scout",
  "sub-onboarding",
  // maintenance jobs
  "outreach-followup",
  "outreach-recovery-sweep",
  "review-expiry-sweep",
  "reply-poll",
  "stalled-pipeline-sweep",
  "deadline-monitor",
  "scoring-recovery-sweep",
  "expired-opportunity-sweep",
  "retention-sweep",
  "compliance-sweep",
  "trial-sweep",
  "concession-sweep",
  "log-retention-sweep",
  "backlink-outreach-sweep",
  "contact-recheck-sweep",
  "unresponsive-sweep",
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];
