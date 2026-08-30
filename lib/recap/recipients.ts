/**
 * Who receives an account's recap, and in whose morning.
 *
 * Three gates, in this order: the account has the recap on, the person's role
 * is one the account chose (or they were named individually), and the person
 * has not opted out. An administrator can also exclude somebody by name, which
 * beats the role rule, because "everyone except the person who asked me to
 * stop" is a real request and the alternative is demoting them.
 *
 * Every recipient carries their own zone, because the whole feature turns on
 * six in the morning meaning six where they are.
 */
import { query } from "../db";
import { isValidTimeZone, safeTimeZone } from "../domain/recap/day-window";
import type { RecapSettings } from "../domain/recap/types";

export interface RecapRecipient {
  userId: string;
  email: string;
  name: string | null;
  orgRole: string;
  timezone: string;
  /** No zone on file; the default is standing in and the settings page says so. */
  timezoneIsDefault: boolean;
}

interface MemberRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  timezone: string | null;
  recap_opt_out: boolean;
}

/** Everybody in the account, whether or not they are eligible. For the settings UI. */
export async function orgMembersForRecap(orgId: string): Promise<
  (RecapRecipient & { optedOut: boolean; eligible: boolean })[]
> {
  const rows = await query<MemberRow>(
    `select u.id, u.email, u.name, m.role, u.timezone, u.recap_opt_out
       from organization_members m
       join users u on u.id = m.user_id
      where m.org_id = $1
      order by
        case m.role when 'owner' then 0 when 'admin' then 1 else 2 end,
        lower(coalesce(u.name, u.email))`,
    [orgId]
  );
  return rows.map((r) => ({
    userId: r.id,
    email: r.email,
    name: r.name,
    orgRole: r.role,
    timezone: safeTimeZone(r.timezone),
    timezoneIsDefault: !isValidTimeZone(r.timezone),
    optedOut: r.recap_opt_out === true,
    eligible: false,
  }));
}

/**
 * The people this account's recap should go to right now.
 *
 * Returns an empty list rather than throwing when the recap is off, so the
 * caller's loop reads as "no recipients" instead of needing a special case.
 */
export async function recapRecipients(
  orgId: string,
  settings: RecapSettings
): Promise<RecapRecipient[]> {
  if (!settings.enabled) return [];

  const rows = await query<MemberRow>(
    `select u.id, u.email, u.name, m.role, u.timezone, u.recap_opt_out
       from organization_members m
       join users u on u.id = m.user_id
      where m.org_id = $1
      order by
        case m.role when 'owner' then 0 when 'admin' then 1 else 2 end,
        lower(coalesce(u.name, u.email))`,
    [orgId]
  );

  const roles = new Set(settings.recipient_roles.map((r) => r.toLowerCase()));
  const named = new Set(settings.recipient_user_ids);
  const excluded = new Set(settings.excluded_user_ids);

  const out: RecapRecipient[] = [];
  for (const r of rows) {
    if (excluded.has(r.id)) continue;
    if (r.recap_opt_out === true) continue;
    const byRole = roles.has((r.role ?? "").toLowerCase());
    if (!byRole && !named.has(r.id)) continue;
    // An address we cannot send to is not a recipient, and pretending
    // otherwise produces a delivery row that fails every morning forever.
    if (!r.email || !r.email.includes("@")) continue;
    out.push({
      userId: r.id,
      email: r.email,
      name: r.name,
      orgRole: r.role,
      timezone: safeTimeZone(r.timezone),
      timezoneIsDefault: !isValidTimeZone(r.timezone),
    });
  }
  return out;
}

/**
 * The platform administrators, as recap recipients.
 *
 * The allowlist is an environment variable of addresses, not a table, so the
 * user rows are looked up by address to find each admin's zone and whether
 * they have switched the recap off. An address on the allowlist with no
 * account behind it still receives the platform recap in the default zone:
 * that is a deployment's own operator address, and it should not be silently
 * dropped because nobody ever signed in with it.
 */
export async function platformRecapRecipients(
  emails: Iterable<string>
): Promise<RecapRecipient[]> {
  const wanted = [...new Set([...emails].map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (wanted.length === 0) return [];

  const rows = await query<{
    id: string;
    email: string;
    name: string | null;
    timezone: string | null;
    recap_opt_out: boolean;
  }>(
    `select id, email, name, timezone, recap_opt_out
       from users
      where lower(email) = any($1::text[])`,
    [wanted]
  ).catch(() => []);

  const byEmail = new Map(rows.map((r) => [r.email.toLowerCase(), r]));

  const out: RecapRecipient[] = [];
  for (const email of wanted) {
    if (!email.includes("@")) continue;
    const row = byEmail.get(email);
    if (row?.recap_opt_out === true) continue;
    out.push({
      // No account behind the address: the delivery row still needs a stable
      // identity, and the address is the one it has.
      userId: row?.id ?? email,
      email: row?.email ?? email,
      name: row?.name ?? null,
      orgRole: "platform_admin",
      timezone: safeTimeZone(row?.timezone ?? null),
      timezoneIsDefault: !isValidTimeZone(row?.timezone ?? null),
    });
  }
  return out;
}

/**
 * Whether this person may see the account-wide recap at all.
 *
 * The recap is an account-level report: it names every opportunity, every
 * subcontractor and every failure in the organization. That is the same
 * information a read-only member can already see on the pages themselves, so
 * viewing the page is open to any member; only the settings are gated, and
 * that gate lives on the route rather than here.
 */
export function canReceiveRecap(role: string | null | undefined): boolean {
  return Boolean(role);
}
