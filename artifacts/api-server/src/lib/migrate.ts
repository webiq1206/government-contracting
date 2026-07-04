/**
 * SQL migration runner. Applies every migrations/*.sql file in filename order,
 * tracking applied files in a `_migrations` table. Idempotent and safe to run on
 * every boot. A Postgres advisory lock serializes concurrent runners (Replit
 * autoscale can boot several instances at once), so migrations apply exactly
 * once even under a thundering herd.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db";
import { logger } from "./logger";

// hashtext('brostco_migrate') — any stable 32-bit key works.
const ADVISORY_LOCK_KEY = 4820133;

/** Find the migrations directory across dev (src) and bundled (dist) layouts. */
function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), "migrations"),
    resolve(here, "..", "..", "migrations"), // dist/index.mjs -> ../../migrations
    resolve(here, "..", "migrations"),
    resolve(here, "..", "..", "..", "migrations"),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error(`migrations directory not found (looked in: ${candidates.join(", ")})`);
}

export async function runMigrations(): Promise<{ applied: string[] }> {
  const client = await pool().connect();
  const applied: string[] = [];
  try {
    // Serialize concurrent boots.
    await client.query("select pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    await client.query(
      `create table if not exists _migrations (
         name text primary key,
         applied_at timestamptz not null default now()
       )`
    );
    const done = new Set(
      (await client.query<{ name: string }>(`select name from _migrations`)).rows.map((r) => r.name)
    );
    const dir = migrationsDir();
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = readFileSync(resolve(dir, file), "utf8");
      try {
        await client.query("begin");
        await client.query(sql);
        await client.query(`insert into _migrations (name) values ($1)`, [file]);
        await client.query("commit");
        applied.push(file);
        logger.info({ file }, "[migrate] applied");
      } catch (err) {
        await client.query("rollback").catch(() => {});
        logger.error({ file, err }, "[migrate] failed");
        throw err;
      }
    }
  } finally {
    await client.query("select pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]).catch(() => {});
    client.release();
  }
  if (applied.length) logger.info({ applied }, "[migrate] complete");
  else logger.info("[migrate] up to date");
  return { applied };
}

// Allow running standalone: `tsx src/lib/migrate.ts`. The argv check (not
// import.meta.url) is bundling-safe: when this module is bundled into the server
// (dist/index.mjs) argv[1] ends with index.mjs, so the block does NOT run on boot.
if (process.argv[1]?.endsWith("migrate.ts")) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
