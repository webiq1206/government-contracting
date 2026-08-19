/**
 * Worker liveness, written by the worker and read by the dashboard.
 *
 * The heartbeat runs on its own timer, deliberately separate from the work the
 * worker is doing, and it records the *phase* the worker is in as well as the
 * time. That combination answers a question a job log cannot:
 *
 *   fresh + "ready"    the engine is alive; a quiet log means no work was due
 *   fresh + any other  the engine is alive but stuck part-way through starting
 *   stale or missing   the process is gone, blocked, or the database is
 *
 * The write is a single upsert of one row. It is intentionally cheap and
 * intentionally not batched with anything else: if it cannot get through, that
 * silence is the signal.
 */
import { randomUUID } from "node:crypto";
import { query, queryOne } from "./db";

/** The single row's key. Liveness is platform-wide, not per tenant. */
const ROW_ID = "worker";

/** Phase names the worker reports. Free-form on purpose, the UI just shows it. */
export const READY_PHASE = "ready";
/**
 * Booted, but the queue backend is no longer answering. The process is alive,
 * so the heartbeat keeps arriving; without this the dashboard would read that
 * as "running normally" while nothing was being picked up.
 */
export const DEGRADED_PHASE = "queue-unreachable";

/**
 * How long a heartbeat stays believable. The worker writes every 30s, so five
 * minutes is ten missed beats: long enough to ride out a slow query or a
 * restart, short enough that a wedged worker is called out within one coffee.
 */
export const HEARTBEAT_STALE_MINUTES = 5;

/** Identifies this process, so a restart is visible as a new instance. */
export const INSTANCE_ID = randomUUID().slice(0, 8);

/** When this process came up. Nothing older than this can belong to it. */
export const PROCESS_STARTED_AT = new Date();

export interface WorkerHeartbeat {
  instanceId: string;
  phase: string;
  detail: string | null;
  bootedAt: string;
  updatedAt: string;
}

export async function recordHeartbeat(phase: string, detail?: string | null): Promise<void> {
  await query(
    `insert into worker_heartbeat (id, instance_id, phase, detail, booted_at, updated_at)
     values ($1, $2, $3, $4, now(), now())
     on conflict (id) do update
       set instance_id = excluded.instance_id,
           phase       = excluded.phase,
           detail      = excluded.detail,
           booted_at   = case when worker_heartbeat.instance_id = excluded.instance_id
                              then worker_heartbeat.booted_at else excluded.booted_at end,
           updated_at  = now()`,
    [ROW_ID, INSTANCE_ID, phase, detail ?? null]
  );
}

export async function readWorkerHeartbeat(): Promise<WorkerHeartbeat | null> {
  const row = await queryOne<{
    instance_id: string;
    phase: string;
    detail: string | null;
    booted_at: string;
    updated_at: string;
  }>(
    `select instance_id, phase, detail, booted_at, updated_at from worker_heartbeat where id = $1`,
    [ROW_ID]
  );
  if (!row) return null;
  return {
    instanceId: row.instance_id,
    phase: row.phase,
    detail: row.detail,
    bootedAt: row.booted_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Start beating. `phase()` is read on every tick rather than passed in once,
 * so a boot that stalls keeps reporting the step it stalled on.
 *
 * A failed write is logged and skipped, never thrown: the heartbeat exists to
 * describe trouble, not to add to it.
 */
export function startHeartbeat(
  phase: () => string,
  intervalMs = 30_000
): () => void {
  // Complain once per outage, not every 30 seconds. The first boot of the
  // deploy that introduces the table writes before the migration creates it,
  // and a repeating error there would bury the boot log it is meant to help.
  let complained = false;
  const beat = async () => {
    try {
      await recordHeartbeat(phase());
      complained = false;
    } catch (err) {
      if (!complained) {
        complained = true;
        console.error("[worker] heartbeat write failed (will keep trying):", (err as Error).message);
      }
    }
  };
  void beat();
  const timer = setInterval(() => void beat(), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

/**
 * Close out runs that were in flight when a previous instance stopped.
 *
 * A `job_runs` row is opened before the agent runs and closed after. Kill the
 * process in between (a redeploy, a crash) and the row stays "running"
 * forever: the Automation Log shows work that is not happening, and every
 * "when did something last run" reading counts a run that never finished.
 *
 * Two conditions, both required, because closing a run that is actually still
 * executing is its own lie:
 *
 *   * it started before this process did, so it cannot be ours, and
 *   * it is older than the age floor, which leaves room for the outgoing
 *     instance of a rolling restart to finish what it is holding.
 *
 * An agent that genuinely runs longer than the floor while its instance is
 * being replaced is the one case this still gets wrong. It is bounded (the
 * queue re-runs the job, and the row is audit history, not control state) and
 * the alternative, leaving every abandoned run open forever, misreports the
 * engine constantly.
 */
export async function closeInterruptedRuns(olderThanMinutes = 60): Promise<number> {
  const rows = await query<{ id: string }>(
    `update job_runs
        set status = 'error',
            finished_at = now(),
            error = 'Interrupted: the worker stopped while this run was in flight.'
      where status = 'running'
        and started_at < $2::timestamptz
        and started_at < now() - ($1 || ' minutes')::interval
      returning id`,
    [String(olderThanMinutes), PROCESS_STARTED_AT.toISOString()]
  );
  return rows.length;
}
