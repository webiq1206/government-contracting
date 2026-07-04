import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { query, queryOne } from "./db";

const SESSION_COOKIE = "brostco_session";
const SESSION_TTL_DAYS = 30;

const AUTH_SECRET = process.env.AUTH_SECRET ?? "dev-insecure-secret-change-me";
const OPERATOR_EMAIL = process.env.OPERATOR_EMAIL ?? "";
const OPERATOR_PASSWORD_HASH = process.env.OPERATOR_PASSWORD_HASH ?? "";

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
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

export async function authenticate(email: string, password: string): Promise<SessionUser | null> {
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

  if (
    OPERATOR_EMAIL &&
    OPERATOR_PASSWORD_HASH &&
    email.toLowerCase().trim() === OPERATOR_EMAIL.toLowerCase() &&
    verifyPassword(password, OPERATOR_PASSWORD_HASH)
  ) {
    return { id: "env-operator", email: OPERATOR_EMAIL, name: "Operator", role: "operator" };
  }
  return null;
}

export async function createSession(userId: string): Promise<string> {
  if (userId === "env-operator") {
    const sig = createHash("sha256")
      .update(`env-operator|${AUTH_SECRET}`)
      .digest("hex")
      .slice(0, 16);
    return `env-operator.${sig}`;
  }
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  await query(`insert into sessions (id, user_id, expires_at) values ($1, $2, $3)`, [
    token,
    userId,
    expires.toISOString(),
  ]);
  return token;
}

export async function resolveSession(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  if (token.startsWith("env-operator.")) {
    const sig = createHash("sha256")
      .update(`env-operator|${AUTH_SECRET}`)
      .digest("hex")
      .slice(0, 16);
    if (token === `env-operator.${sig}` && OPERATOR_EMAIL) {
      return { id: "env-operator", email: OPERATOR_EMAIL, name: "Operator", role: "operator" };
    }
    return null;
  }
  const row = await queryOne<{
    id: string;
    email: string;
    name: string | null;
    role: string;
  }>(
    `select u.id, u.email, u.name, u.role
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

export { SESSION_COOKIE };
