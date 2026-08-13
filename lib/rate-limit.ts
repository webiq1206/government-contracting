/**
 * A small fixed-window rate limiter for routes that face the open internet.
 *
 * In-memory on purpose, following the throttle already in the login route: the
 * platform runs as a single instance, and a Postgres-backed counter would add
 * a write to every request in order to defend against a threat that a Map
 * handles. The tradeoff is stated rather than hidden:
 *
 *   - Counts are per process. Behind more than one instance each gets its own
 *     allowance, so the effective limit multiplies by the instance count. That
 *     is fine for stopping a script and not fine as a billing control.
 *   - Counts reset on deploy. Also fine here: the thing being prevented is a
 *     sustained hammering, not a single burst.
 *
 * If this ever needs to hold across instances, the shape below is deliberately
 * the shape of a Redis INCR/EXPIRE, so the swap is one function body.
 */

export interface RateLimitRule {
  /** Requests allowed inside the window. */
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  /** Allowance left in the current window. Zero once the limit is reached. */
  remaining: number;
  /** Seconds until the window resets. Suitable for a Retry-After header. */
  retryAfterSeconds: number;
}

interface Entry {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Entry>();

/**
 * A ceiling on how many keys are tracked at once.
 *
 * Without it, an attacker rotating source addresses grows the map until the
 * process runs out of memory, which turns a rate limiter into the outage it
 * was added to prevent. Generous enough that ordinary traffic never reaches
 * it: every key expires on its own window.
 */
const MAX_KEYS = 20_000;

/** How often expired entries are swept, at most. */
const SWEEP_INTERVAL_MS = 60_000;
let lastSweep = 0;

function sweep(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, entry] of buckets) {
    if (now > entry.resetAt) buckets.delete(key);
  }
  if (buckets.size <= MAX_KEYS) return;
  // Still over after sweeping, so this is an attack rather than accumulation.
  // Drop the entries closest to expiring: they have the least time left to
  // protect anything, and evicting them keeps the freshest counters intact.
  const byExpiry = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
  for (const [key] of byExpiry.slice(0, buckets.size - MAX_KEYS)) buckets.delete(key);
}

/**
 * Count one request against a key and say whether it is allowed.
 *
 * `bucket` namespaces the rule (so a signing limit and an upload limit on the
 * same address do not share a counter); `key` is the thing being limited, such
 * as an address or a token.
 */
export function consume(bucket: string, key: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const mapKey = `${bucket}:${key}`;
  let entry = buckets.get(mapKey);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + rule.windowMs };
    buckets.set(mapKey, entry);
  }
  entry.count += 1;

  const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
  return {
    ok: entry.count <= rule.limit,
    remaining: Math.max(0, rule.limit - entry.count),
    retryAfterSeconds,
  };
}

/** Clear a key's counter, for when a request turns out to be legitimate. */
export function forget(bucket: string, key: string): void {
  buckets.delete(`${bucket}:${key}`);
}

/**
 * The caller's address.
 *
 * x-forwarded-for is a chain when proxies stack; the first entry is the
 * client. It is spoofable by anyone talking to the origin directly, which is
 * why this is a throttle on casual abuse and not an access control. The real
 * access control on these routes is the signed token.
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/** A 429 with the header a well-behaved client will honour. */
export function tooManyRequests(message: string, result: RateLimitResult): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(result.retryAfterSeconds),
    },
  });
}

/** Reset everything. Tests only. */
export function __resetRateLimits(): void {
  buckets.clear();
  lastSweep = 0;
}
