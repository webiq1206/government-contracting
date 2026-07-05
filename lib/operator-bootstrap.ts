/**
 * Env-driven operator account bootstrap.
 *
 * If OPERATOR_EMAIL and OPERATOR_PASSWORD are set (Replit Secrets), the worker
 * ensures at boot that an operator with that email exists and that its
 * password matches — creating the account or updating the hash as needed.
 *
 * This is how the owner's login is provisioned WITHOUT any password ever
 * being committed to the repo or typed by anyone but the owner: the secret
 * lives only in the deployment environment, and only its scrypt hash reaches
 * the database. The password value itself is never logged.
 */
import { query, queryOne } from "./db";
import { hashPassword, verifyPassword } from "./auth";

export async function ensureOperatorFromEnv(): Promise<void> {
  const email = process.env.OPERATOR_EMAIL?.trim().toLowerCase();
  const password = process.env.OPERATOR_PASSWORD;
  if (!email || !password) return;
  if (password.length < 8) {
    console.warn("[operator-bootstrap] OPERATOR_PASSWORD is under 8 characters; skipping.");
    return;
  }

  try {
    const existing = await queryOne<{ id: string; password_hash: string }>(
      `select id, password_hash from users where lower(email) = $1`,
      [email]
    );
    if (!existing) {
      await query(
        `insert into users (email, password_hash, name, role) values ($1, $2, 'Operator', 'operator')`,
        [email, hashPassword(password)]
      );
      console.log(`[operator-bootstrap] created operator ${email}`);
      return;
    }
    if (!verifyPassword(password, existing.password_hash)) {
      await query(`update users set password_hash = $2 where id = $1`, [
        existing.id,
        hashPassword(password),
      ]);
      console.log(`[operator-bootstrap] updated password for ${email}`);
    }
  } catch (err) {
    console.error("[operator-bootstrap] failed:", (err as Error).message);
  }
}
