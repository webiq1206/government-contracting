/**
 * Migration runner. Applies every db/migrations/*.sql file in order, tracking
 * applied files in a `_migrations` table. Idempotent and safe to re-run.
 *
 *   npm run db:migrate
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pool, query, closePool } from "../lib/db";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "db", "migrations");

async function main() {
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

  console.log(count === 0 ? "Up to date." : `Applied ${count} migration(s).`);
  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
