/**
 * Shared migration runner. Applies every db/migrations/*.sql file in order,
 * tracking applied files in a `_migrations` table. Idempotent and safe to
 * re-run; an advisory lock serializes concurrent runners (deploy boot racing
 * a manual run, or two autoscale instances booting together).
 *
 * Called from `npm run db:migrate` (scripts/migrate.ts) and automatically by
 * the worker at boot, so pushing a new migration file to main is enough to
 * get it applied on the next deploy.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pool, query } from "./db";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "db", "migrations");
const MIGRATE_LOCK_KEY = 4820731;

export async function applyMigrations(): Promise<number> {
  const lockClient = await pool().connect();
  await lockClient.query(`select pg_advisory_lock($1)`, [MIGRATE_LOCK_KEY]);
  try {
    return await run();
  } finally {
    await lockClient.query(`select pg_advisory_unlock($1)`, [MIGRATE_LOCK_KEY]).catch(() => {});
    lockClient.release();
  }
}

async function run(): Promise<number> {
  await query(`
    create table if not exists _migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const applied = new Set(
    (await query<{ name: string }>(`select name from _migrations`)).map((r) => r.name)
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`= skip ${file} (already applied)`);
      continue;
    }
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool().connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(`insert into _migrations (name) values ($1)`, [file]);
      await client.query("COMMIT");
      console.log(`+ applied ${file}`);
      count++;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error(`x failed ${file}:`, (err as Error).message);
      throw err;
    } finally {
      client.release();
    }
  }

  console.log(count === 0 ? "Migrations up to date." : `Applied ${count} migration(s).`);
  return count;
}
