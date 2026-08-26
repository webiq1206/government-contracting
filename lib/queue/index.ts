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
  /**
   * Is this backend still able to serve the queue? A live process proves
   * nothing about the consumer inside it: pg-boss can stop or lose its
   * connection while the worker keeps happily reporting for duty.
   */
  healthy?(): Promise<boolean>;
}

let _queue: Queue | null = null;
let _starting: Promise<Queue> | null = null;
/**
 * Bumped by every reset. A start that finishes after its generation was
 * superseded belongs to nobody: it is stopped and discarded rather than
 * published, so a retry can never be overwritten by the attempt it replaced.
 */
let _generation = 0;

/**
 * The singleton is only published once it has actually started, and only if it
 * is still the current attempt.
 *
 * It used to be assigned before `start()` was awaited, so a start that failed
 * or never returned left a half-built queue cached as if it were live: every
 * later caller got it, no caller could retry, and the process stayed up
 * enqueuing into nothing. A timed-out start is worse than a failed one, because
 * the abandoned attempt is still running and can still succeed later, hence the
 * generation check below.
 */
export async function getQueue(): Promise<Queue> {
  if (_queue) return _queue;
  if (_starting) return _starting;
  const generation = _generation;
  const attempt = (async () => {
    const created =
      config.queue.backend === "bullmq"
        ? await (await import("./bullmq")).createBullQueue()
        : await (await import("./pgboss")).createPgBossQueue();
    await created.start();
    if (generation !== _generation) {
      // Someone gave up on this attempt and started another one. Leaving this
      // backend connected would leave a second consumer polling the queue.
      await created.stop().catch(() => {});
      throw new Error("queue start superseded by a newer attempt");
    }
    _queue = created;
    return created;
  })();
  _starting = attempt;
  try {
    return await attempt;
  } finally {
    // Only clear the slot if it is still ours; a newer attempt owns it now.
    if (_starting === attempt) _starting = null;
  }
}

/**
 * Drop the current queue so the next `getQueue()` builds a fresh one, and
 * invalidate any attempt still in flight.
 *
 * Used by the worker between connection attempts: retrying against a backend
 * object whose own start half-completed reconnects nothing.
 */
export async function resetQueue(): Promise<void> {
  _generation++;
  const current = _queue;
  _queue = null;
  _starting = null;
  if (current) await current.stop().catch(() => {});
}

/** Enqueue from anywhere (API routes, agents) without owning the worker. */
export async function enqueue(
  name: string,
  payload: JobPayload = {},
  opts?: EnqueueOptions
): Promise<string | null> {
  const { isAutomationStopped } = await import("../app-settings");
  if (await isAutomationStopped()) {
    console.warn(`[queue] enqueue skipped (automation paused): ${name}`);
    return null;
  }
  /*
   * Do not queue new work for a pursuit the operator has stopped.
   *
   * The runner refuses stopped pursuits when a job runs, which is what stops
   * the work. This stops it being created, and the two are not the same: the
   * recovery sweeps exist precisely to re-enqueue things that did not happen,
   * so without this an aborted opportunity gets its scoring job recreated
   * every fifteen minutes, forever, each one refused and logged. The queue
   * fills with work whose only outcome is a refusal, and the Automation Log
   * fills with it too.
   *
   * Reads the payload's opportunityId rather than a tenant claim: this asks
   * about one record's state, not about permission, so the record is the
   * right thing to ask.
   */
  const oppId = typeof payload.opportunityId === "string" ? payload.opportunityId : "";
  if (oppId) {
    const { pursuitStatus } = await import("../pursuit-guard");
    const pursuit = await pursuitStatus(oppId);
    if (!pursuit.mayAct && pursuit.known) {
      console.warn(`[queue] enqueue skipped (pursuit stopped): ${name} for ${oppId}`);
      return null;
    }
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
  _generation++;
  _starting = null;
  if (_queue) {
    const current = _queue;
    _queue = null;
    await current.stop();
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
  "account-deletion-sweep",
  "compliance-sweep",
  "trial-sweep",
  "concession-sweep",
  "log-retention-sweep",
  "backlink-outreach-sweep",
  "contact-recheck-sweep",
  "unresponsive-sweep",
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];
