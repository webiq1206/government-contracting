/**
 * Password reset via single-use tokens, emailed through the platform inbox.
 */
import { createHash, randomBytes } from "node:crypto";
import { query, queryOne } from "./db";
import { hashPassword } from "./auth";
import { config } from "./config";
import { systemMail } from "./integrations/system-mail";
import { trackEvent } from "./analytics";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function requestPasswordReset(email: string): Promise<{ ok: true }> {
  const user = await queryOne<{ id: string; email: string; name: string | null }>(
    `select id, email, name from users where email = $1`,
    [email.toLowerCase().trim()]
  );
  // Always succeed to avoid account enumeration.
  if (!user) return { ok: true };

  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  await query(
    `insert into password_reset_tokens (user_id, token_hash, expires_at)
     values ($1, $2, $3)`,
    [user.id, tokenHash, expires.toISOString()]
  );

  const resetUrl = `${config.appUrl.replace(/\/$/, "")}/reset-password?token=${token}`;
  await sendResetEmail(user.email, user.name, resetUrl);
  await trackEvent({
    event: "password_reset_requested",
    userId: user.id,
    path: "/forgot-password",
  });
  return { ok: true };
}

async function sendResetEmail(
  to: string,
  name: string | null,
  resetUrl: string
): Promise<void> {
  if (!(await systemMail.enabled())) {
    // Nothing can be delivered. Log the link in development so the flow is
    // still testable, and stay silent in production rather than leaking a
    // reset URL into the logs of a live system.
    if (!config.isProd) {
      console.info(`[password-reset] ${to}: ${resetUrl}`);
    }
    return;
  }
  await systemMail
    .send({
      to,
      subject: "Reset your Brost Co password",
      text: [
        name ? `Hi ${name},` : "Hi,",
        "",
        "Reset your Brost Co password using this link (expires in 1 hour):",
        resetUrl,
        "",
        "If you did not request this, you can ignore this email.",
      ].join("\n"),
    })
    .catch((err) => console.error("[password-reset] email failed", err));
}

export async function resetPasswordWithToken(input: {
  token: string;
  password: string;
}): Promise<{ ok: true } | { error: string }> {
  if (input.password.length < 10) {
    return { error: "Password must be at least 10 characters." };
  }
  const tokenHash = hashToken(input.token);
  const row = await queryOne<{ id: string; user_id: string }>(
    `select id, user_id from password_reset_tokens
      where token_hash = $1 and used_at is null and expires_at > now()`,
    [tokenHash]
  );
  if (!row) return { error: "This reset link is invalid or has expired." };

  const password_hash = hashPassword(input.password);
  await query(`update users set password_hash = $2 where id = $1`, [
    row.user_id,
    password_hash,
  ]);
  await query(`update password_reset_tokens set used_at = now() where id = $1`, [
    row.id,
  ]);
  // Invalidate all sessions for this user.
  await query(`delete from sessions where user_id = $1`, [row.user_id]);
  await trackEvent({
    event: "password_reset_completed",
    userId: row.user_id,
    path: "/reset-password",
  });
  return { ok: true };
}
