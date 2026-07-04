/**
 * Postgres access. A single shared pool (Supabase-compatible). All query helpers
 * are thin wrappers so agents and API routes share one connection strategy.
 */
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { config } from "./config";

let _pool: Pool | null = null;

export function pool(): Pool {
  if (_pool) return _pool;
  if (!config.database.url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and set your Postgres/Supabase URL."
    );
  }
  _pool = new Pool({
    connectionString: config.database.url,
    // Supabase requires TLS; allow self-signed in managed environments.
    ssl: config.database.url.includes("localhost")
      ? undefined
      : { rejectUnauthorized: false },
    max: Number(process.env.PG_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  _pool.on("error", (err) => {
    // Never crash the process on an idle client error.
    console.error("[db] idle client error:", err.message);
  });
  return _pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const res = await pool().query<T>(text, params as never[]);
  return res.rows;
}

/** Query expecting at most one row. */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** Run fn inside a transaction, committing on success and rolling back on throw. */
export async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** True if the DB is reachable — used by health checks and boot gating. */
export async function dbHealthy(): Promise<boolean> {
  try {
    await query("select 1");
    return true;
  } catch {
    return false;
  }
}

export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
