import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { currentSessionId, hashPassword, verifyPassword } from "@/lib/auth";
import { transaction } from "@/lib/db";
import { clientIp, consume, tooManyRequests } from "@/lib/rate-limit";
import { trackEvent } from "@/lib/analytics";
import { impersonationRefusal } from "@/lib/impersonation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Matches signup and the reset link, so one rule governs every password this product accepts. */
const MIN_LENGTH = 10;

/**
 * Change your own password while signed in.
 *
 * Until now the only way to change a password was the emailed reset link,
 * which meant a person who simply wanted to rotate a password had to declare
 * they had lost it, wait for mail, and get signed out of every device. It also
 * meant somebody who suspected their password was known had no way to change
 * it that did not depend on their mailbox, which is the account most likely to
 * be compromised alongside it.
 *
 * The current password is required. Without it, a borrowed unlocked laptop
 * becomes a permanent takeover rather than a session someone can end from the
 * sessions list below.
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const supportRefusal = impersonationRefusal(auth);
  if (supportRefusal) return supportRefusal;

  // Keyed by user and by address: guessing the current password is a guessing
  // attack like any other, and it is being made from inside a session.
  const gate = consume("account-password", `${auth.id}|${clientIp(req)}`, {
    limit: 5,
    windowMs: 15 * 60_000,
  });
  if (!gate.ok) {
    return tooManyRequests("Too many attempts. Try again in a few minutes.", gate);
  }

  const body = (await req.json().catch(() => null)) as {
    currentPassword?: unknown;
    newPassword?: unknown;
  } | null;
  const current = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const next = typeof body?.newPassword === "string" ? body.newPassword : "";

  if (!current || !next) {
    return NextResponse.json(
      { error: "Enter your current password and the new one." },
      { status: 400 }
    );
  }
  if (next.length < MIN_LENGTH) {
    return NextResponse.json(
      { error: `Your new password must be at least ${MIN_LENGTH} characters.` },
      { status: 400 }
    );
  }
  if (next === current) {
    return NextResponse.json(
      { error: "That is the password you already have. Choose a different one." },
      { status: 400 }
    );
  }

  /*
   * Every other session goes, and this one stays.
   *
   * The reset link ends all of them, including the browser doing the resetting,
   * because there the person has just proved control of the mailbox rather than
   * of a session. Here they proved they know the old password from inside a
   * live session, so signing them out of the device they are holding would be
   * punishing the good case. Anyone else holding the old password is out.
   */
  const keep = await currentSessionId();
  let result:
    | { kind: "external" }
    | { kind: "wrong" }
    | { kind: "changed"; removed: number };
  try {
    result = await transaction(async (client) => {
      const selected = await client.query<{ password_hash: string }>(
        `select password_hash from users where id = $1 for update`,
        [auth.id]
      );
      const row = selected.rows[0];
      if (!row?.password_hash) return { kind: "external" as const };
      if (!verifyPassword(current, row.password_hash)) return { kind: "wrong" as const };

      await client.query(`update users set password_hash = $2 where id = $1`, [
        auth.id,
        hashPassword(next),
      ]);
      const removed = keep
        ? await client.query<{ id: string }>(
            `delete from sessions where user_id = $1 and id <> $2 returning id`,
            [auth.id, keep]
          )
        : await client.query<{ id: string }>(
            `delete from sessions where user_id = $1 returning id`,
            [auth.id]
          );
      return { kind: "changed" as const, removed: removed.rowCount ?? removed.rows.length };
    });
  } catch (error) {
    console.error("[account] password change failed before commit", error);
    return NextResponse.json(
      {
        error:
          "Your password was not changed because the account update could not be completed. Your existing password and sessions are unchanged. Try again.",
      },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }

  if (result.kind === "external") {
    // The env operator signs in against a hash in configuration and has no
    // users row, so there is nothing here to change. Said plainly rather than
    // failing as if the password were wrong.
    return NextResponse.json(
      { error: "This sign-in is configured outside the application, so its password cannot be changed here." },
      { status: 400 }
    );
  }
  if (result.kind === "wrong") {
    return NextResponse.json({ error: "That is not your current password." }, { status: 400 });
  }

  void trackEvent({
    event: "password_changed",
    userId: auth.id,
    orgId: auth.organizationId,
    path: "/settings/account",
  });

  return NextResponse.json({ ok: true, otherSessionsEnded: result.removed });
}
