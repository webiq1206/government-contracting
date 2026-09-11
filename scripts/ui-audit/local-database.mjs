import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
export async function startDatabase() {
  if (
    process.env.BROSTCO_LOCAL_QA !== "1" ||
    process.env.NODE_ENV === "production" ||
    process.env.USE_REPLIT_DEV_DB !== "true" ||
    process.env.PGHOST !== "127.0.0.1" ||
    process.env.PGPORT !== "5544" ||
    process.env.PGDATABASE !== "brostco_audit"
  )
    throw Error("Disposable preview database configuration required.");
  const dataDir =
    process.env.BROSTCO_QA_DATA_DIR === ".qa-test-db"
      ? ".qa-test-db"
      : ".qa-db";
  const db = await PGlite.create({
    dataDir,
    extensions: { pg_trgm, uuid_ossp },
  });
  const server = new PGLiteSocketServer({
    db,
    host: "127.0.0.1",
    port: 5544,
    maxConnections: 100,
  });
  await server.start();
  return { db, server };
}
async function prepare() {
  const { db, server } = await startDatabase();
  await db.exec(
    "create table if not exists _migrations (name text primary key, applied_at timestamptz default now(), checksum text)",
  );
  const applied = new Set(
    (await db.query("select name from _migrations")).rows.map((x) => x.name),
  );
  for (const name of readdirSync("db/migrations")
    .filter((x) => x.endsWith(".sql"))
    .sort()) {
    if (applied.has(name)) continue;
    const raw = readFileSync("db/migrations/" + name, "utf8");
    // PGlite has gen_random_uuid built in. Only its unavailable pgcrypto extension
    // declaration is omitted in this disposable preview, never in release migrations.
    const sql = raw.replace(/create extension if not exists "pgcrypto";/i, "");
    try {
      await db.exec(sql);
      await db.query("insert into _migrations(name,checksum) values($1,$2)", [
        name,
        createHash("sha256").update(raw).digest("hex"),
      ]);
    } catch (error) {
      console.error("Preview migration failed:", name, error.message);
      process.exit(1);
    }
  }
  const run = (script) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", script], {
        stdio: "inherit",
        env: process.env,
      });
      child.on("exit", (code) =>
        code ? reject(Error(script + " failed")) : resolve(),
      );
    });
  const users = await db.query(
    "select id from users where email='ui-owner@example.test'",
  );
  if (!users.rows.length) {
    await run("scripts/seed.ts");
    await run("scripts/ui-audit/seed.ts");
  }
  await server.stop();
  await db.close();
  console.log("Disposable preview prepared.");
}
if (process.argv.includes("--prepare")) await prepare();
