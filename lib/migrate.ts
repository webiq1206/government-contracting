/**
 * Shared migration runner. Applies every db/migrations/*.sql file in order,
 * tracking applied files in a `_migrations` table. Idempotent and safe to
 * re-run; an advisory lock serializes concurrent runners (deploy boot racing
 * a manual run, or two autoscale instances booting together).
 *
 * Called from `npm run db:migrate` (scripts/migrate.ts) and automatically by
 * the worker at boot, so pushing a new migration file to main is enough to
 * get it applied on the next deploy.
 *
 * Two things here exist because of a deploy that stopped dead inside this
 * file and logged nothing for eight hours:
 *
 *   * It runs on its own connection with its own, longer deadline instead of
 *     the shared pool's, so a legitimately slow migration is not cut off at
 *     the pool's two minutes and a hung one still ends.
 *   * It reports a summary ("57 applied, 1 pending") rather than one line per
 *     already-applied file. Fifty-odd identical lines in the same millisecond
 *     are what a log collector drops, and the two that survived told nobody
 *     how far the run had actually got.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Client } from "pg";
import { standaloneClient } from "./db";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "db", "migrations");
const MIGRATE_LOCK_KEY = 4820731;

/** A single migration may run this long before it is treated as stuck. */
const MIGRATION_TIMEOUT_MS = Number(process.env.PG_MIGRATION_TIMEOUT_MS ?? 600_000);
/**
 * How long to wait for a table lock before giving up. A migration blocked
 * behind someone else's lock used to wait forever, holding the advisory lock
 * that every other booting instance needs. Failing after a minute leaves a
 * message in the log and lets the next boot try again.
 */
const LOCK_TIMEOUT_MS = 60_000;

export async function applyMigrations(): Promise<number> {
  const client = standaloneClient({
    queryTimeoutMs: MIGRATION_TIMEOUT_MS,
    applicationName: "brostco-migrate",
  });
  await client.connect();
  let locked = false;
  try {
    await client.query(`set lock_timeout to ${LOCK_TIMEOUT_MS}`);
    // Bounded by query_timeout above: waiting forever for the advisory lock is
    // how one wedged instance silently blocks every later deploy.
    await client.query(`select pg_advisory_lock($1)`, [MIGRATE_LOCK_KEY]);
    locked = true;
    return await run(client);
  } finally {
    if (locked) {
      await client.query(`select pg_advisory_unlock($1)`, [MIGRATE_LOCK_KEY]).catch(() => {});
    }
    await client.end().catch(() => {});
  }
}

async function run(client: Client): Promise<number> {
  await client.query(`
    create table if not exists _migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const applied = new Set(
    (await client.query<{ name: string }>(`select name from _migrations`)).rows.map((r) => r.name)
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const pending = files.filter((f) => !applied.has(f));

  console.log(
    `[migrate] ${files.length} migration file(s), ${files.length - pending.length} already applied, ${pending.length} pending` +
      (pending.length ? `: ${pending.join(", ")}` : "")
  );

  let count = 0;
  for (const file of pending) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const started = Date.now();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(`insert into _migrations (name) values ($1)`, [file]);
      await client.query("COMMIT");
      console.log(`[migrate] + applied ${file} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
      count++;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error(`[migrate] x failed ${file}:`, (err as Error).message);
      throw err;
    }
  }

  console.log(count === 0 ? "[migrate] up to date." : `[migrate] applied ${count} migration(s).`);
  return count;
}
