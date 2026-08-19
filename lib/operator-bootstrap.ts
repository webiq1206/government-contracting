/**
 * Env-driven operator account bootstrap.
 *
 * If OPERATOR_EMAIL and OPERATOR_PASSWORD are set (Replit Secrets), the worker
 * ensures at boot that an operator with that email exists, creating it from
 * the secret when it is missing.
 *
 * This is how the owner's login is provisioned WITHOUT any password ever
 * being committed to the repo or typed by anyone but the owner: the secret
 * lives only in the deployment environment, and only its scrypt hash reaches
 * the database. The password value itself is never logged.
 *
 * Bootstrap CREATES; it never overwrites. It used to also force an existing
 * account's password back to the secret whenever the two differed, which
 * quietly undid every password the owner set in the app: the change held until
 * the next worker boot, then sign-in failed with no explanation and no trace of
 * what had reset it. A password the owner chose in the app is the more recent
 * intent and always wins.
 *
 * Recovery for a forgotten password is the app's password reset flow, which
 * rotates the hash only after a single-use emailed token is validated. That is
 * the only path that changes an existing account's password, so keep email
 * delivery working. Rotating OPERATOR_PASSWORD does NOT reset anything once the
 * account exists; seeding and the signup bootstrap route are create-only too.
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
      // Deliberately no write. The account already exists with a password that
      // is not the secret, which normally means the owner changed it in the
      // app. Overwriting here would lock them out at the next restart.
      console.warn(
        `[operator-bootstrap] ${email} already exists and its password does not match OPERATOR_PASSWORD. ` +
          `Leaving the stored password alone; a password set in the app outranks the secret. ` +
          `To reset a forgotten password, use the password reset flow.`
      );
    }
  } catch (err) {
    console.error("[operator-bootstrap] failed:", (err as Error).message);
  }
}
