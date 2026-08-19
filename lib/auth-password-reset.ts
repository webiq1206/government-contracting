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

/**
 * Whether a reset link could be put on the wire at all.
 *
 * "unavailable" is deliberately a property of the mail transport and nothing
 * else, so reporting it to whoever asked cannot reveal which addresses have
 * accounts: it reads the same for an address that exists and one that does not.
 * A send that fails for one specific recipient stays silent for that reason and
 * is logged instead.
 */
export type PasswordResetDelivery = "sent" | "unavailable";

export async function requestPasswordReset(
  email: string
): Promise<{ ok: true; delivery: PasswordResetDelivery }> {
  // Answered before the account is looked up, so the result is account
  // independent. Without this, a reset request during an email outage returned
  // the same cheerful "check your email" as a working one, and the only way to
  // discover nothing had been sent was to keep waiting for a link that was
  // never coming.
  const canDeliver = await systemMail.deliverable().catch(() => false);
  // The whole answer, fixed here. Nothing learned later in this request is
  // allowed to change it, because everything learned later depends on whether
  // the address has an account.
  const delivery: PasswordResetDelivery = canDeliver ? "sent" : "unavailable";
  if (!canDeliver && config.isProd) {
    // Stop before the account is touched. Minting a token nobody can receive
    // just leaves a live credential lying in the table, and answering from
    // here means a database that is itself down cannot turn this into a
    // "check your email" that was never true.
    return { ok: true, delivery: "unavailable" };
  }

  // Accepts a login alias as well as the account's own address: someone whose
  // working address is an alias will type that one, and being told nothing
  // happened would be indistinguishable from the account not existing.
  const { findUserByLoginEmail } = await import("./auth");
  const user = await findUserByLoginEmail(email);
  // Always succeed to avoid account enumeration.
  if (!user) return { ok: true, delivery };
  // Send to the address that was entered, not the canonical one. The person
  // asking may only have access to the alias inbox, and mailing somewhere else
  // would look like the reset silently failed.
  const deliverTo = email.toLowerCase().trim();

  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  await query(
    `insert into password_reset_tokens (user_id, token_hash, expires_at)
     values ($1, $2, $3)`,
    [user.id, tokenHash, expires.toISOString()]
  );

  const resetUrl = `${config.appUrl.replace(/\/$/, "")}/reset-password?token=${token}`;
  // Deliberately not used for the answer. Everything this call learns is
  // specific to an address that has an account, so letting it change the
  // response is how the endpoint would become a way to test which addresses
  // those are. It records the failure instead, and the next request (for any
  // address, including one with no account) reports that nothing can be sent.
  await sendResetEmail(deliverTo, user.name, resetUrl, canDeliver);
  await trackEvent({
    event: "password_reset_requested",
    userId: user.id,
    path: "/forgot-password",
  });
  return { ok: true, delivery };
}

async function sendResetEmail(
  to: string,
  name: string | null,
  resetUrl: string,
  canDeliver: boolean
): Promise<PasswordResetDelivery> {
  if (!canDeliver) {
    // Only reachable outside production, where the link is logged so the flow
    // stays testable without a mail transport. A live system stays silent
    // rather than putting a working reset URL in its logs.
    console.info(`[password-reset] ${to}: ${resetUrl}`);
    return "unavailable";
  }
  const result = await systemMail
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
    .catch((err) => ({ error: err instanceof Error ? err.message : String(err) }));

  // Logged, never returned to the caller. Anything learned here is known only
  // for an address that has an account, so letting it reach the response would
  // turn the endpoint into a way to test which addresses those are. When the
  // cause is the inbox itself rather than this recipient, the transport records
  // it against the connection, and the next request reads that instead.
  const refused = "disabled" in result && result.disabled;
  const failed = Boolean(result.error);
  if (refused || failed) {
    console.error(
      `[password-reset] no link was sent (${refused ? "transport refused" : "send failed"}):`,
      result.error
    );
    return "unavailable";
  }
  return "sent";
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
