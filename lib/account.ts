/**
 * A person's own account: who they are, what their role lets them do, and
 * where they are signed in.
 *
 * Everything in this file is scoped to one user id, never to an organization.
 * The distinction matters: an account owner and a read-only teammate share an
 * organization and must not share a sessions list, and the settings pages
 * beside this one are all organization-wide.
 */
import { query, queryOne } from "./db";
import type { SessionRow } from "./domain/session-device";

export interface AccountDetails {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  /** Other addresses that sign in as this person, from the alias table. */
  aliases: string[];
}

/** node-postgres returns Date for timestamptz, so convert rather than cast. */
function iso(v: unknown): string {
  if (v == null) return "";
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function isoOrNull(v: unknown): string | null {
  const s = iso(v);
  return s ? s : null;
}

export async function accountDetails(userId: string): Promise<AccountDetails | null> {
  const row = await queryOne<Record<string, unknown>>(
    `select u.id, u.email, u.name, u.created_at,
            coalesce(
              (select array_agg(a.email order by a.email)
                 from user_email_aliases a where a.user_id = u.id),
              '{}'
            ) as aliases
       from users u where u.id = $1`,
    [userId]
  ).catch(() => null);
  if (!row) return null;
  return {
    id: String(row.id),
    email: String(row.email),
    name: (row.name as string | null) ?? null,
    createdAt: iso(row.created_at),
    aliases: Array.isArray(row.aliases) ? (row.aliases as string[]) : [],
  };
}

/**
 * Every live session for this person, newest first.
 *
 * Expired rows are excluded rather than shown as expired: a session that can
 * no longer authenticate is not a device somebody needs to think about, and
 * listing it invites a person to "sign out" something already gone.
 */
export async function accountSessions(userId: string): Promise<SessionRow[]> {
  const rows = await query<Record<string, unknown>>(
    `select id, created_at, expires_at, last_seen_at, user_agent, impersonator_email
       from sessions
      where user_id = $1 and expires_at > now()
      order by coalesce(last_seen_at, created_at) desc
      limit 50`,
    [userId]
  ).catch(() => [] as Record<string, unknown>[]);
  return rows.map((r) => ({
    id: String(r.id),
    createdAt: iso(r.created_at),
    expiresAt: iso(r.expires_at),
    lastSeenAt: isoOrNull(r.last_seen_at),
    userAgent: (r.user_agent as string | null) ?? null,
    impersonatorEmail: (r.impersonator_email as string | null) ?? null,
  }));
}

/**
 * End one session belonging to this person.
 *
 * Scoped by user_id in the statement rather than checked beforehand: a session
 * id is a bearer token, and a delete that trusts a caller-supplied id would
 * let anyone signed in end anyone else's session by guessing one.
 *
 * Returns how many rows went, so the caller can tell "signed out" from "that
 * session was already gone" instead of reporting success either way.
 */
/**
 * These two do not catch, deliberately.
 *
 * Both used to swallow the error and return 0, and 0 is not distinguishable
 * from "the row was already gone". So a database that refused the delete
 * produced "That session had already ended" for one device, and `ok: true`
 * for every other device, while the sessions stayed live. Somebody who opens
 * this page because they think their account has been used is exactly the
 * person who must not be told a sign-out worked when it did not.
 *
 * The caller reports the failure instead. A revocation that cannot be
 * confirmed is a failure, not a quiet zero.
 */
export async function revokeSession(userId: string, sessionId: string): Promise<number> {
  const rows = await query<{ id: string }>(
    `delete from sessions where id = $1 and user_id = $2 returning id`,
    [sessionId, userId]
  );
  return rows.length;
}

/** End every session except the one making the request. */
export async function revokeOtherSessions(
  userId: string,
  keepSessionId: string
): Promise<number> {
  const rows = await query<{ id: string }>(
    `delete from sessions where user_id = $1 and id <> $2 returning id`,
    [userId, keepSessionId]
  );
  return rows.length;
}
