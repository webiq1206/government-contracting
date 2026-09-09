/**
 * Postgres access. A single shared pool (Supabase-compatible). All query helpers
 * are thin wrappers so agents and API routes share one connection strategy.
 */
import { Client, Pool, types, type PoolClient, type QueryResultRow } from "pg";
import { config, pgSslFor } from "./config";
import { currentOrgId, runWithOrg } from "./tenant-context";

/**
 * No query may hang forever.
 *
 * A pooled connection whose socket dies mid-query does not fail: the promise
 * simply never settles. The worker spent a night parked on exactly that, alive
 * and doing nothing, with no error to log because no error was ever raised.
 * `query_timeout` is the client-side stopwatch that turns that silence into a
 * rejection; `statement_timeout` is the server side of the same deadline, so a
 * genuinely long query is cancelled in Postgres instead of being abandoned
 * while it keeps running.
 *
 * Web requests default to fifteen seconds so stalled reads release capacity.
 * Background work retains its two-minute ceiling. Migrations get their own,
 * longer budget: see lib/migrate.ts.
 */
// Interactive requests must not occupy scarce connections for two minutes.
// The worker and migration budgets remain separate; explicit operator limits
// still take precedence. Invalid settings cannot silently disable deadlines.
const configuredTimeout = Number(process.env.PG_QUERY_TIMEOUT_MS ??
  (process.env.BROSTCO_PROCESS_ROLE === "web" ? process.env.PG_WEB_QUERY_TIMEOUT_MS ?? 15_000 : 120_000));
const QUERY_TIMEOUT_MS = Number.isFinite(configuredTimeout) && configuredTimeout > 0
  ? configuredTimeout
  : process.env.BROSTCO_PROCESS_ROLE === "web" ? 15_000 : 120_000;

// Postgres NUMERIC/DECIMAL comes through pg as a STRING by default (to preserve
// arbitrary precision). Every call site that does `.toFixed()` / arithmetic on a
// numeric column would otherwise silently break (a rating string ".toFixed(1)"
// throws; a "10" + 1 concatenates to "101"). Parse them as JS numbers globally.
// Precision loss beyond 2^53 doesn't apply to our columns (scores 0-100, ratings
// 0-5, USD amounts well under 2^53).
// OID 1700 = numeric, 1231 = _numeric (array).
types.setTypeParser(1700, (val) => (val == null ? null : Number(val)));

let _pool: Pool | null = null;

/**
 * Refuse to let a test run open a connection to anything but the disposable
 * development database.
 *
 * Integration tests here create real users, organizations and jobs. A run
 * pointed at DATABASE_URL puts all of that in the live database, where it is
 * indistinguishable from real signups until someone reads the user list. That
 * has already happened once: dozens of `@example.test` accounts appeared in
 * production in a single evening.
 *
 * Detection cannot rely on NODE_ENV alone: it is pinned to "production" for
 * this repl, so a test run inherits that value. VITEST is set by the runner in
 * every worker process and inherited by children, and NODE_ENV=test is accepted
 * as a second signal for a child spawned with a rebuilt environment. A child
 * given an environment that carries neither is not covered; test helpers that
 * spawn processes must pass one of them through.
 *
 * Fails closed: without the development flag there is no proof the target is
 * disposable, and the override has to be typed out deliberately.
 */
function assertDisposableDatabaseUnderTest(): void {
  if (!process.env.VITEST && process.env.NODE_ENV !== "test") return;
  if (config.database.isIsolatedDev) return;
  if (process.env.ALLOW_TESTS_AGAINST_DATABASE_URL === "1") return;
  throw new Error(
    "Refusing to run tests against this database. USE_REPLIT_DEV_DB is not set, so DATABASE_URL is the target and that is the live database. " +
      "Set USE_REPLIT_DEV_DB=true to use the repl's built-in Postgres, or set ALLOW_TESTS_AGAINST_DATABASE_URL=1 if this database really is disposable."
  );
}

export function pool(): Pool {
  if (_pool) return _pool;
  assertDisposableDatabaseUnderTest();
  if (!config.database.url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and set your Postgres/Supabase URL."
    );
  }
  const url = config.database.url;
  _pool = new Pool({
    connectionString: url,
    ssl: pgSslFor(url),
    max: Number(process.env.PG_POOL_MAX ?? 10),
    // Recycle idle connections before Supabase's pooler closes them server-side
    // (which surfaced as intermittent "Connection terminated due to connection
    // timeout" errors in the frequent worker crons), and keep sockets warm.
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    query_timeout: QUERY_TIMEOUT_MS,
    statement_timeout: QUERY_TIMEOUT_MS,
  });
  _pool.on("error", (err) => {
    // Never crash the process on an idle client error.
    console.error("[db] idle client error:", err.message);
  });
  return _pool;
}

/**
 * A connection of its own, outside the shared pool.
 *
 * For work that must not inherit the pool's deadlines, currently only the
 * migration runner, which holds an advisory lock for the length of a deploy's
 * schema changes and may legitimately run a single statement for minutes. It
 * still goes through the same disposable-database guard, because a migration
 * run is exactly as capable of writing to the live database as a test is.
 *
 * The caller owns the connection: connect it, end it.
 */
export function standaloneClient(opts: {
  queryTimeoutMs: number;
  applicationName: string;
  /** Dedicated owner connection for release-time migrations. */
  connectionString?: string;
}): Client {
  assertDisposableDatabaseUnderTest();
  const url = opts.connectionString ?? config.database.url;
  if (!url) throw new Error("DATABASE_URL is not set.");
  return new Client({
    connectionString: url,
    ssl: pgSslFor(url),
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    query_timeout: opts.queryTimeoutMs,
    statement_timeout: opts.queryTimeoutMs,
    application_name: opts.applicationName,
  });
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
    const orgId = currentOrgId();
    if (orgId) await setLocalTenantContext(client, orgId);
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

const ORG_ID_RE =
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/**
 * Set the organization used by PostgreSQL row-level-security policies.
 *
 * `is_local=true` is the important part: PostgreSQL clears this value at the
 * transaction boundary even when the pooled connection is reused. A session
 * level SET here would eventually hand one customer's context to another
 * request through the pool.
 *
 * Call this only after BEGIN. Outside a transaction PostgreSQL clears a local
 * setting at the end of this statement, so it would not protect later work.
 */
export async function setLocalTenantContext(
  client: PoolClient,
  orgId: string
): Promise<void> {
  if (!ORG_ID_RE.test(orgId)) {
    throw new Error(
      "A valid organization id is required for tenant database access."
    );
  }

  await client.query(
    `select pg_catalog.set_config('brostco.org_id', $1, true)`,
    [orgId]
  );
}

/**
 * Run a unit of tenant-owned database work with one transaction-local owner.
 *
 * This is the migration path from application-only `where org_id = ...`
 * filters to PostgreSQL RLS. The callback receives the transaction's client;
 * every statement in the unit of work must use that client rather than the
 * process-wide query helper, which may select another pooled connection.
 *
 * An existing AsyncLocalStorage tenant cannot be replaced. Background jobs
 * establish that context from a database-owned record before they begin, and
 * accepting a different id here would turn a confused-deputy bug into an RLS
 * bypass inside the application process.
 */
export async function tenantTransaction<T>(
  orgId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const ambientOrgId = currentOrgId();
  if (ambientOrgId && ambientOrgId !== orgId) {
    throw new Error(
      "Tenant database context does not match the active organization."
    );
  }

  return runWithOrg(orgId, () =>
    transaction((client) => fn(client))
  );
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
