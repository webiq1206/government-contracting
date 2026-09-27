import { Client } from "pg";
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

async function main() {
  const connectionString = process.env.MIGRATION_DATABASE_URL?.trim();
  const expectedHost = process.env.EXPECTED_DATABASE_HOST?.trim();
  const expectedName = process.env.EXPECTED_DATABASE_NAME?.trim();
  if (!connectionString || !expectedHost || !expectedName) {
    throw new Error("Configure the owner-only migration secret and expected production host/database environment variables.");
  }
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || url.hostname !== expectedHost
    || decodeURIComponent(url.pathname.slice(1)) !== expectedName) {
    throw new Error("Migration connection does not match the independently configured production target.");
  }
  const action = process.env.RELEASE_ACTION;
  if (action !== "inspect" && action !== "apply") throw new Error("Choose inspect or apply explicitly.");
  if (process.env.USE_REPLIT_DEV_DB !== "false") throw new Error("This is an owner-only production release job.");

  // Set the verifier target before importing application configuration.
  process.env.DATABASE_URL = connectionString;
  const client = new Client({ connectionString, connectionTimeoutMillis: 10_000, query_timeout: 15_000 });
  await client.connect();
  try {
    await client.query("begin read only");
    const identity = await client.query("select current_database() as database, current_user as role");
    if (identity.rows[0].database !== expectedName) throw new Error("Connected database does not match the expected target.");
    const ledger = await client.query<{ name: string; checksum: string | null }>("select name, checksum from _migrations order by name");
    const applied = new Map(ledger.rows.map(r => [r.name, r.checksum]));
    const files = readdirSync("db/migrations").filter(f => f.endsWith(".sql")).sort();
    const pending = files.filter(f => !applied.has(f));
    const mismatched = files.filter(f => applied.has(f)
      && applied.get(f) !== createHash("sha256").update(readFileSync(`db/migrations/${f}`)).digest("hex"));
    console.log(JSON.stringify({ commit: process.env.GITHUB_SHA, database: identity.rows[0].database,
      role: identity.rows[0].role, applied: applied.size, pending, mismatched }, null, 2));
    await client.query("rollback");
    if (mismatched.length) throw new Error("Migration checksums require owner review; no changes were applied.");
  } finally {
    await client.end();
  }
  if (action === "inspect") return;
  const { applyMigrations, verifyMigrationsCurrent } = await import("../lib/migrate");
  const { closePool } = await import("../lib/db");
  try {
    await applyMigrations();
    await verifyMigrationsCurrent();
    console.log("Production migration ledger verified. Deployment is a separate step.");
  } finally {
    await closePool();
  }
}

main().catch(error => {
  // Do not serialize driver objects or connection strings into Actions logs.
  const message = error instanceof Error ? error.message : "Production release failed";
  const secret = process.env.MIGRATION_DATABASE_URL;
  console.error(secret ? message.split(secret).join("[redacted]") : message);
  process.exitCode = 1;
});
