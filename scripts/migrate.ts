/**
 * Migration runner CLI. Applies every db/migrations/*.sql file in order.
 * Idempotent and safe to re-run. The worker also applies pending migrations
 * automatically at boot (lib/migrate.ts).
 *
 *   npm run db:migrate
 */
import { applyMigrations } from "../lib/migrate";
import { closePool } from "../lib/db";

applyMigrations()
  .then(async () => {
    await closePool();
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
