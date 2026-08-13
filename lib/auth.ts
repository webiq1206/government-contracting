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
  /**
   * End of the cardless trial, carried on the session so every access gate can
   * judge expiry without a second query. A status alone cannot tell a live
   * trial from a lapsed one.
   */
  trialEndsAt: string | null;
  /**
   * The org is comped: full access whatever the subscription says. Carried on
   * the session for the same reason as trialEndsAt, so a gate holding only a
   * session can reach the right answer without another query.
   */
  billingExempt: boolean;
  /** Set when an admin has suspended the org. Outranks billingExempt. */
  suspendedAt: string | null;
  /**
   * Email of the platform admin currently signed in as this account, or null
   * for an ordinary session. Anything sensitive must check this: an
   * impersonated session is a support tool, not the account holder.
   */
  impersonatedBy: string | null;
}

/** The fields every SessionUser gets before attachOrg fills in the org ones. */
const NO_ORG = {
  organizationId: null,
  subscriptionStatus: null,
  planKey: null,
  trialEndsAt: null,
  billingExempt: false,
  suspendedAt: null,
  impersonatedBy: null,
} as const;

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

interface LoginRow {
  id: string;
  email: string;
  password_hash: string;
  name: string | null;
  role: string;
}

/**
 * Find the account that owns a sign-in address.
 *
 * An account can be reached by its own address or by any of its aliases, and
 * either way this returns the canonical user row. The alias is a front door,
 * not a second identity: the session, the displayed email and outbound mail
 * all keep using `users.email`.
 */
export async function findUserByLoginEmail(email: string): Promise<LoginRow | null> {
  const normalized = email.toLowerCase().trim();
  if (!normalized) return null;

  const direct = await queryOne<LoginRow>(
    `select id, email, password_hash, name, role from users where lower(email) = $1`,
    [normalized]
  );
  if (direct) return direct;

  return queryOne<LoginRow>(
    `select u.id, u.email, u.password_hash, u.name, u.role
       from user_email_aliases a
       join users u on u.id = a.user_id
      where lower(a.email) = $1`,
    [normalized]
  );
}

/**
 * Verify credentials. Accepts the account's own address or any of its login
 * aliases. Falls back to the env operator (OPERATOR_EMAIL +
 * OPERATOR_PASSWORD_HASH) when no account matches at all, so the platform is
 * loginnable immediately after setting those two env vars.
 */
export async function authenticate(
  email: string,
  password: string
): Promise<SessionUser | null> {
  const user = await findUserByLoginEmail(email);

  if (user) {
    if (!verifyPassword(password, user.password_hash)) return null;
    return attachOrg({
      ...NO_ORG,
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
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
      ...NO_ORG,
      id: "env-operator",
      email: config.auth.operatorEmail,
      name: "Operator",
      role: "operator",
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
      trialEndsAt: org?.trial_ends_at ?? null,
      billingExempt: Boolean(org?.billing_exempt),
      suspendedAt: org?.suspended_at ?? null,
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

/**
 * How long a support session lasts. Short on purpose: an admin signed in as a
 * customer is the highest-privilege state in the product, and the failure mode
 * to design against is not an attacker, it is an admin who wandered off with
 * the tab open.
 */
export const IMPERSONATION_TTL_MINUTES = 60;

/**
 * Open a session as another account, marked with who opened it.
 *
 * The admin's own session id is stored on the row so "return to admin" can put
 * the original session back rather than forcing a re-login. Keeping the marker
 * on the session row, not in a second cookie, means a browser that drops
 * cookies cannot turn a support session into an unmarked one.
 */
export async function createImpersonationSession(input: {
  targetUserId: string;
  adminUserId: string | null;
  adminEmail: string;
  adminSessionId: string | null;
}): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + IMPERSONATION_TTL_MINUTES * 60_000);
  await query(
    `insert into sessions
       (id, user_id, expires_at, impersonator_user_id, impersonator_email, impersonator_session_id)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      token,
      input.targetUserId,
      expires.toISOString(),
      // The env operator has no users row, so only its email is recorded.
      input.adminUserId && input.adminUserId !== "env-operator" ? input.adminUserId : null,
      input.adminEmail,
      input.adminSessionId,
    ]
  );
  return token;
}

/**
 * Close a support session and hand back the admin's original session token.
 *
 * Returns null when the token is not an impersonation or the original session
 * has since expired; the caller should then just sign the browser out rather
 * than leave it holding a dead cookie.
 */
export async function endImpersonation(token: string | undefined): Promise<string | null> {
  if (!token || token.startsWith("env-operator.")) return null;
  const row = await queryOne<{
    impersonator_session_id: string | null;
    impersonator_email: string | null;
  }>(
    `select impersonator_session_id, impersonator_email from sessions
      where id = $1 and impersonator_email is not null`,
    [token]
  );
  if (!row) return null;
  await query(`delete from sessions where id = $1`, [token]).catch(() => {});
  if (!row.impersonator_session_id) return null;
  const original = await queryOne<{ id: string }>(
    `select id from sessions where id = $1 and expires_at > now()`,
    [row.impersonator_session_id]
  );
  return original?.id ?? null;
}

export async function resolveSession(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  if (token.startsWith("env-operator.")) {
    if (envOperatorAllowed() && config.auth.operatorEmail && verifyEnvOperator(token)) {
      return attachOrg({
        ...NO_ORG,
        id: "env-operator",
        email: config.auth.operatorEmail,
        name: "Operator",
        role: "operator",
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
    impersonator_email: string | null;
  }>(
    `select u.id, u.email, u.name, u.role, s.expires_at, s.impersonator_email
       from sessions s join users u on u.id = s.user_id
      where s.id = $1 and s.expires_at > now()`,
    [token]
  );
  if (!row) return null;
  const user = await attachOrg({
    ...NO_ORG,
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
  });
  // Set last so attachOrg cannot drop it.
  return { ...user, impersonatedBy: row.impersonator_email };
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
