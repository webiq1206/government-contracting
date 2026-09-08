/** Read-only startup gate for restricted web runtime processes. */
import { verifyMigrationsCurrent } from "../lib/migrate";
import { closePool } from "../lib/db";

verifyMigrationsCurrent()
  .then(async () => {
    await closePool();
  })
  .catch(async (error) => {
    console.error("[schema-check]", error instanceof Error ? error.message : String(error));
    await closePool().catch(() => {});
    process.exit(1);
  });
