/**
 * A run that was in flight when the worker stopped must not stay "running"
 * forever. Two instances stayed open through an outage, which makes the
 * Automation Log advertise work that is not happening and makes "when did
 * something last run" count a run that never finished.
 *
 * The recovery is deliberately conservative: it only touches runs that started
 * before this process did (so it can never close its own) and only after a
 * grace period (so an outgoing instance can finish what it is holding). Which
 * is why the worker also sweeps on a timer, not just at boot: a run
 * interrupted minutes before the restart is younger than the grace period when
 * the boot sweep looks at it.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("closing out runs interrupted by a restart (integration)", () => {
  let query: typeof import("../lib/db").query;
  let closeInterruptedRuns: typeof import("../lib/worker-heartbeat").closeInterruptedRuns;
  const agent = `recovery-test-${randomUUID().slice(0, 8)}`;

  /** A run opened `minutesAgo` ago and never closed. */
  async function openRun(minutesAgo: number): Promise<string> {
    const rows = await query<{ id: string }>(
      `insert into job_runs (agent, trigger, status, started_at)
       values ($1, 'queue', 'running', now() - ($2 || ' minutes')::interval)
       returning id`,
      [agent, String(minutesAgo)]
    );
    return rows[0].id;
  }

  async function statusOf(id: string): Promise<string> {
    const rows = await query<{ status: string }>(`select status from job_runs where id = $1`, [id]);
    return rows[0].status;
  }

  beforeAll(async () => {
    ({ query } = await import("../lib/db"));
    ({ closeInterruptedRuns } = await import("../lib/worker-heartbeat"));
  });

  afterAll(async () => {
    if (query) await query(`delete from job_runs where agent = $1`, [agent]);
  });

  it("closes a run left open by an instance that is long gone", async () => {
    const stale = await openRun(180);
    expect(await closeInterruptedRuns()).toBeGreaterThan(0);
    expect(await statusOf(stale)).toBe("error");
    const rows = await query<{ error: string; finished_at: string | null }>(
      `select error, finished_at from job_runs where id = $1`,
      [stale]
    );
    expect(rows[0].error).toContain("Interrupted");
    expect(rows[0].finished_at).not.toBeNull();
  });

  it("leaves a run that could still be executing alone", async () => {
    const recent = await openRun(5);
    await closeInterruptedRuns();
    expect(await statusOf(recent)).toBe("running");
  });

  it("catches that same run on a later sweep, once the grace period has passed", async () => {
    const recent = await openRun(5);
    await closeInterruptedRuns();
    expect(await statusOf(recent)).toBe("running");
    // What the worker's timer does an hour later: same call, the run is now
    // older than the floor. Nothing about the row changed except its age.
    expect(await closeInterruptedRuns(1)).toBeGreaterThan(0);
    expect(await statusOf(recent)).toBe("error");
  });

  it("never closes a run this process could own", async () => {
    // Opened now, so it started after this process did. Even with no grace
    // period at all it must survive: it is the running worker's own work.
    const mine = await openRun(0);
    await closeInterruptedRuns(0);
    expect(await statusOf(mine)).toBe("running");
  });
});
