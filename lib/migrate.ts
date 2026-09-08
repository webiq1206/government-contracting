/**
 * Shared migration runner. Applies every db/migrations/*.sql file in order,
 * tracking applied files in a `_migrations` table. Idempotent and safe to
 * re-run; an advisory lock serializes concurrent runners (deploy boot racing
 * a manual run, or two autoscale instances booting together).
 *
 * Called only from the release-time `npm run db:migrate` command. Web and
 * worker runtime processes use a restricted database role and only verify
 * that the expected migration ledger is present.
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
import { createHash } from "node:crypto";
import type { Client } from "pg";
import { query, standaloneClient } from "./db";
import { config } from "./config";

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
  const dedicatedUrl = process.env.MIGRATION_DATABASE_URL?.trim();
  if (!dedicatedUrl && config.isProd && !config.database.isIsolatedDev) {
    throw new Error(
      "MIGRATION_DATABASE_URL is required for production migrations. Run this as a release job with an owner-only connection that is not available to the web or worker runtime."
    );
  }
  const client = standaloneClient({
    queryTimeoutMs: MIGRATION_TIMEOUT_MS,
    applicationName: "brostco-migrate",
    connectionString: dedicatedUrl || config.database.url,
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

/** Migration filenames expected by this exact application build. */
export function expectedMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

function migrationChecksum(name: string): string {
  return createHash("sha256")
    .update(readFileSync(join(MIGRATIONS_DIR, name)))
    .digest("hex");
}

function expectedMigrationChecksums(): Map<string, string> {
  return new Map(expectedMigrations().map((name) => [name, migrationChecksum(name)]));
}

/**
 * Read-only runtime gate. A process must not serve or execute work when the
 * release migration job has not installed the schema this build expects.
 */
export async function verifyMigrationsCurrent(): Promise<void> {
  let rows: { name: string; checksum: string | null }[];
  try {
    rows = await query<{ name: string; checksum: string | null }>(
      `select name, checksum from _migrations`
    );
  } catch {
    throw new Error(
      "The database migration ledger cannot verify file checksums. Run the owner-only migration job for this release before starting runtime services."
    );
  }

  const expected = expectedMigrationChecksums();
  const applied = new Map(rows.map((row) => [row.name, row.checksum]));
  const missing = [...expected.keys()].filter((name) => !applied.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Database schema is behind this release. Run the owner-only migration job before starting runtime services. Missing: ${missing.join(", ")}`
    );
  }

  const unverifiable = [...expected.keys()].filter((name) => !applied.get(name));
  if (unverifiable.length > 0) {
    throw new Error(
      `The migration ledger has no checksum for: ${unverifiable.join(", ")}. Verify and baseline legacy rows with the owner-only migration job before starting runtime services.`
    );
  }

  const changed = [...expected.entries()]
    .filter(([name, checksum]) => applied.get(name) !== checksum)
    .map(([name]) => name);
  if (changed.length > 0) {
    throw new Error(
      `Applied migration files changed after installation: ${changed.join(", ")}. Do not edit applied migrations; restore those files and put corrections in a new migration.`
    );
  }
}

async function run(client: Client): Promise<number> {
  await client.query(`
    create table if not exists _migrations (
      name text primary key,
      checksum text,
      applied_at timestamptz not null default now()
    )
  `);
  await client.query(`alter table _migrations add column if not exists checksum text`);

  const appliedRows = (
    await client.query<{ name: string; checksum: string | null }>(
      `select name, checksum from _migrations`
    )
  ).rows;
  const applied = new Map(appliedRows.map((row) => [row.name, row.checksum]));

  const files = expectedMigrations();
  const checksums = expectedMigrationChecksums();
  const changed = files.filter(
    (file) => applied.get(file) && applied.get(file) !== checksums.get(file)
  );
  if (changed.length > 0) {
    throw new Error(
      `Applied migration files changed after installation: ${changed.join(", ")}. Restore them and create a new migration instead.`
    );
  }

  const legacy = files.filter((file) => applied.has(file) && !applied.get(file));
  if (legacy.length > 0) {
    if (process.env.ALLOW_MIGRATION_CHECKSUM_BASELINE !== "1") {
      throw new Error(
        `The migration ledger predates checksum verification for: ${legacy.join(", ")}. Compare the deployed schema with these files, then rerun this one time with ALLOW_MIGRATION_CHECKSUM_BASELINE=1 to record the reviewed baseline.`
      );
    }
    await client.query("BEGIN");
    try {
      for (const file of legacy) {
        await client.query(
          `update _migrations set checksum = $2 where name = $1 and checksum is null`,
          [file, checksums.get(file)]
        );
        applied.set(file, checksums.get(file)!);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    }
    console.log(`[migrate] recorded reviewed checksums for ${legacy.length} legacy migration(s).`);
  }

  // Once the reviewed legacy baseline is complete, make an unverified ledger
  // row impossible even for future migration-runner changes.
  await client.query(`alter table _migrations alter column checksum set not null`);

  const pending = files.filter((file) => !applied.has(file));

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
      await client.query(`insert into _migrations (name, checksum) values ($1, $2)`, [
        file,
        checksums.get(file),
      ]);
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
