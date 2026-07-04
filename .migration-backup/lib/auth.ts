/**
 * Authentication: scrypt password hashing (no native bcrypt dependency) and
 * server-side sessions stored in the `sessions` table. Phase 1 is single
 * operator; the users table + role column make multi-user a later add.
 */
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { cookies } from "next/headers";
import { query, queryOne } from "./db";
import { config } from "./config";

const SESSION_COOKIE = "brostco_session";
const SESSION_TTL_DAYS = 30;

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
}

/**
 * Verify credentials. Falls back to the env operator (OPERATOR_EMAIL +
 * OPERATOR_PASSWORD_HASH) when the users table has no matching row yet — so the
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
    return verifyPassword(password, user.password_hash)
      ? { id: user.id, email: user.email, name: user.name, role: user.role }
      : null;
  }

  // Env-operator fallback.
  if (
    config.auth.operatorEmail &&
    config.auth.operatorPasswordHash &&
    email.toLowerCase().trim() === config.auth.operatorEmail.toLowerCase() &&
    verifyPassword(password, config.auth.operatorPasswordHash)
  ) {
    return {
      id: "env-operator",
      email: config.auth.operatorEmail,
      name: "Operator",
      role: "operator",
    };
  }
  return null;
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  // env-operator has no users row; store a hashed synthetic id reference safely.
  if (userId === "env-operator") {
    // Use a signed cookie value instead of a DB row for the env operator.
    const sig = createHash("sha256")
      .update(`env-operator|${config.auth.secret}`)
      .digest("hex")
      .slice(0, 16);
    return `env-operator.${sig}`;
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
    const sig = createHash("sha256")
      .update(`env-operator|${config.auth.secret}`)
      .digest("hex")
      .slice(0, 16);
    if (token === `env-operator.${sig}` && config.auth.operatorEmail) {
      return {
        id: "env-operator",
        email: config.auth.operatorEmail,
        name: "Operator",
        role: "operator",
      };
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
  return row ? { id: row.id, email: row.email, name: row.name, role: row.role } : null;
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
