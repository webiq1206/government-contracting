/**
 * Migration runner CLI. Applies every db/migrations/*.sql file in order.
 * Idempotent and safe to re-run. In production this requires the dedicated
 * MIGRATION_DATABASE_URL owner credential and runs before runtime services.
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
