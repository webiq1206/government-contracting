/**
 * Serialize the platform-wide maintenance sweeps across test files.
 *
 * The outreach follow-up sweep is deliberately platform-wide: it is a cron with
 * no payload that reads every organization's due conversations. That is correct
 * behaviour and it is what two different files test. Vitest runs files in
 * parallel workers against one database, so file A's sweep would pick up file
 * B's freshly inserted conversation, send it, and mark it done, leaving B's own
 * sweep with nothing and B's assertions reading zero.
 *
 * Neither file was wrong and neither failed consistently, which is the worst
 * shape a test failure comes in: it appears on some runs, points at the code
 * under test, and gets investigated as a product bug.
 *
 * A Postgres advisory lock held across the setup and the sweep makes each
 * file's insert-then-sweep atomic with respect to the others, without
 * serializing the other three hundred test files.
 */
import { pool } from "../../lib/db";

/** One shared key. Any test that drives a platform-wide sweep uses this. */
const SWEEP_LOCK_KEY = 728_411_003;

export async function withSweepLock<T>(fn: () => Promise<T>): Promise<T> {
  /*
   * A dedicated connection, not a pooled query. A session-level advisory lock
   * belongs to the connection that took it, and lib/db.query hands back a
   * different pool member each call, so the unlock could land on a connection
   * that never held it and the lock would leak until the process exited.
   */
  const client = await pool().connect();
  try {
    await client.query("select pg_advisory_lock($1)", [SWEEP_LOCK_KEY]);
    return await fn();
  } finally {
    await client.query("select pg_advisory_unlock($1)", [SWEEP_LOCK_KEY]).catch(() => {});
    client.release();
  }
}
