/**
 * Authentication: scrypt password hashing (no native bcrypt dependency) and
 * server-side sessions stored in the `sessions` table. Sessions resolve the
 * user's organization for tenant isolation.
 */
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { query, queryOne } from "./db";
import { config } from "./config";

const SESSION_COOKIE = "brostco_session";
const SESSION_TTL_DAYS = 30;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 86_400_000;

/**
 * The env-operator has no `users`/`sessions` row, so its cookie is a self-signed
 * token: `env-operator.<issuedAtMs>.<hmac>`. Using a full-length HMAC over the
 * issued-at time (not a truncated sha256 of a constant) means the token expires
 * and cannot be recomputed without AUTH_SECRET.
 */
function signEnvOperator(issuedAt: number): string {
  const mac = createHmac("sha256", config.auth.secret)
    .update(`env-operator|${issuedAt}`)
    .digest("hex");
  return `env-operator.${issuedAt}.${mac}`;
}

/** Refuse the env-operator path in production if AUTH_SECRET is still the default
 * (a public value would let anyone forge the operator cookie). */
function envOperatorAllowed(): boolean {
  return !(config.isProd && config.auth.secretIsDefault);
}

function verifyEnvOperator(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "env-operator") return false;
  const issuedAt = Number(parts[1]);
  if (!Number.isFinite(issuedAt)) return false;
  if (Date.now() - issuedAt > SESSION_TTL_MS) return false; // expired
  const expected = signEnvOperator(issuedAt);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, salt, hash] = stored.split("$");
    if (scheme !== "scrypt" || !salt || !hash) return false;
    const derived = scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, "hex");
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  /** Active organization for this session (tenant boundary). */
  organizationId: string | null;
  /** Stripe subscription_status for the org (active, trialing, none, …). */
  subscriptionStatus: string | null;
  planKey: string | null;
}

/**
 * True when at least one operator-role user exists in the DB. Used by the
 * login/setup routing so a fresh deployment (empty users table, env-operator
 * secrets not configured) can bootstrap its first operator through the UI
 * instead of leaving the app permanently unreachable.
 */
export async function hasAnyOperator(): Promise<boolean> {
  try {
    const row = await queryOne<{ n: string }>(`select count(*)::text as n from users`);
    return Number(row?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Verify credentials. Falls back to the env operator (OPERATOR_EMAIL +
 * OPERATOR_PASSWORD_HASH) when the users table has no matching row yet, so the
 * platform is loginnable immediately after setting those two env vars.
 */
export async function authenticate(
  email: string,
  password: string
): Promise<SessionUser | null> {
  const user = await queryOne<{
    id: string;
    email: string;
    password_hash: string;
    name: string | null;
    role: string;
  }>(`select id, email, password_hash, name, role from users where email = $1`, [
    email.toLowerCase().trim(),
  ]);

  if (user) {
    if (!verifyPassword(password, user.password_hash)) return null;
    return attachOrg({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organizationId: null,
      subscriptionStatus: null,
      planKey: null,
    });
  }

  // Env-operator fallback (disabled in prod when AUTH_SECRET is the default).
  if (
    envOperatorAllowed() &&
    config.auth.operatorEmail &&
    config.auth.operatorPasswordHash &&
    email.toLowerCase().trim() === config.auth.operatorEmail.toLowerCase() &&
    verifyPassword(password, config.auth.operatorPasswordHash)
  ) {
    return attachOrg({
      id: "env-operator",
      email: config.auth.operatorEmail,
      name: "Operator",
      role: "operator",
      organizationId: null,
      subscriptionStatus: null,
      planKey: null,
    });
  }
  return null;
}

async function attachOrg(user: SessionUser): Promise<SessionUser> {
  try {
    const { getOrgForUser } = await import("./organizations");
    const org = await getOrgForUser(user.id);
    return {
      ...user,
      organizationId: org?.id ?? null,
      subscriptionStatus: org?.subscription_status ?? null,
      planKey: org?.plan_key ?? null,
    };
  } catch {
    return user;
  }
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  // env-operator has no users row; issue a self-signed, time-limited token.
  if (userId === "env-operator") {
    return signEnvOperator(Date.now());
  }
  await query(
    `insert into sessions (id, user_id, expires_at) values ($1, $2, $3)`,
    [token, userId, expires.toISOString()]
  );
  return token;
}

export async function resolveSession(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  if (token.startsWith("env-operator.")) {
    if (envOperatorAllowed() && config.auth.operatorEmail && verifyEnvOperator(token)) {
      return attachOrg({
        id: "env-operator",
        email: config.auth.operatorEmail,
        name: "Operator",
        role: "operator",
        organizationId: null,
        subscriptionStatus: null,
        planKey: null,
      });
    }
    return null;
  }
  const row = await queryOne<{
    id: string;
    email: string;
    name: string | null;
    role: string;
    expires_at: string;
  }>(
    `select u.id, u.email, u.name, u.role, s.expires_at
       from sessions s join users u on u.id = s.user_id
      where s.id = $1 and s.expires_at > now()`,
    [token]
  );
  if (!row) return null;
  return attachOrg({
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    organizationId: null,
    subscriptionStatus: null,
    planKey: null,
  });
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (token && !token.startsWith("env-operator.")) {
    await query(`delete from sessions where id = $1`, [token]).catch(() => {});
  }
}

// ---- Next.js cookie helpers (used by server components / route handlers) ----

export async function setSessionCookie(token: string): Promise<void> {
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProd,
    path: "/",
    maxAge: SESSION_TTL_DAYS * 86_400,
  });
}

export async function clearSessionCookie(): Promise<void> {
  cookies().delete(SESSION_COOKIE);
}

export async function currentUser(): Promise<SessionUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  return resolveSession(token);
}

export { SESSION_COOKIE };
