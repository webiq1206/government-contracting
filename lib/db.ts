/**
 * Postgres access. A single shared pool (Supabase-compatible). All query helpers
 * are thin wrappers so agents and API routes share one connection strategy.
 */
import { Pool, types, type PoolClient, type QueryResultRow } from "pg";
import { config } from "./config";

// Postgres NUMERIC/DECIMAL comes through pg as a STRING by default (to preserve
// arbitrary precision). Every call site that does `.toFixed()` / arithmetic on a
// numeric column would otherwise silently break (a rating string ".toFixed(1)"
// throws; a "10" + 1 concatenates to "101"). Parse them as JS numbers globally.
// Precision loss beyond 2^53 doesn't apply to our columns (scores 0-100, ratings
// 0-5, USD amounts well under 2^53).
// OID 1700 = numeric, 1231 = _numeric (array).
types.setTypeParser(1700, (val) => (val == null ? null : Number(val)));

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
    // Recycle idle connections before Supabase's pooler closes them server-side
    // (which surfaced as intermittent "Connection terminated due to connection
    // timeout" errors in the frequent worker crons), and keep sockets warm.
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
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

/** True if the DB is reachable, used by health checks and boot gating. */
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
