/**
 * Recap settings, per account, plus the two personal preferences.
 *
 * Reads and writes take the organization id explicitly. `lib/app-settings.ts`
 * resolves the tenant from ambient context, which is right for a page serving
 * a signed-in person and wrong for a worker walking every account in turn: the
 * morning send would read the founding organization's preferences and apply
 * them to everybody. The key scoping convention is the same as that module's,
 * deliberately, so the two never disagree about where a row lives.
 */
import { query, queryOne } from "../db";
import { LEGACY_ORG_ID } from "../tenant-context";
import {
  DEFAULT_RECAP_SETTINGS,
  normalizeRecapSettings,
  type RecapSettings,
} from "../domain/recap/types";
import { DEFAULT_TIMEZONE, isValidTimeZone, safeTimeZone } from "../domain/recap/day-window";

const RECAP_KEY = "daily_recap";

/** The founding organization keeps the bare key; everybody else is prefixed. */
function scopedKey(orgId: string): string {
  return orgId && orgId !== LEGACY_ORG_ID ? `${orgId}:${RECAP_KEY}` : RECAP_KEY;
}

/**
 * This account's settings, with defaults filled in.
 *
 * A read that throws returns the defaults rather than propagating. The recap
 * is a report about the account's health; failing to send it because the
 * settings row could not be read would make a database hiccup silently cancel
 * the one message that would have reported the hiccup.
 */
export async function getRecapSettings(orgId: string): Promise<RecapSettings> {
  try {
    const row = await queryOne<{ value_json: Partial<RecapSettings> | null }>(
      `select value_json from app_settings where key = $1`,
      [scopedKey(orgId)]
    );
    return normalizeRecapSettings(row?.value_json ?? null);
  } catch {
    return { ...DEFAULT_RECAP_SETTINGS };
  }
}

/** Whether anybody on this account has ever opened the settings. */
export async function recapConfigured(orgId: string): Promise<boolean> {
  const row = await queryOne<{ key: string }>(
    `select key from app_settings where key = $1`,
    [scopedKey(orgId)]
  ).catch(() => null);
  return row != null;
}

export async function setRecapSettings(
  orgId: string,
  input: Partial<RecapSettings>,
  by: string
): Promise<RecapSettings> {
  const normalized = normalizeRecapSettings(input);
  await query(
    `insert into app_settings (key, value_json, updated_at, updated_by, org_id)
     values ($1, $2::jsonb, now(), $3, $4)
     on conflict (key) do update
       set value_json = excluded.value_json,
           updated_at = now(),
           updated_by = excluded.updated_by,
           org_id = excluded.org_id`,
    [scopedKey(orgId), JSON.stringify(normalized), by, orgId]
  );
  return normalized;
}

// ---------------------------------------------------------------------------
// Personal preferences
// ---------------------------------------------------------------------------

export interface UserRecapPreference {
  userId: string;
  email: string;
  name: string | null;
  timezone: string;
  /** True when the stored zone is null or unusable and the default is standing in. */
  timezoneIsDefault: boolean;
  optedOut: boolean;
}

export async function getUserRecapPreference(userId: string): Promise<UserRecapPreference | null> {
  const row = await queryOne<{
    id: string;
    email: string;
    name: string | null;
    timezone: string | null;
    recap_opt_out: boolean;
  }>(`select id, email, name, timezone, recap_opt_out from users where id = $1`, [userId]);
  if (!row) return null;
  return {
    userId: row.id,
    email: row.email,
    name: row.name,
    timezone: safeTimeZone(row.timezone),
    timezoneIsDefault: !isValidTimeZone(row.timezone),
    optedOut: row.recap_opt_out === true,
  };
}

/**
 * Store a person's zone.
 *
 * Validated against Intl rather than against a list, so somebody who genuinely
 * is in a zone the picker does not offer can still be right. An unusable value
 * is refused rather than stored, because the failure would otherwise surface
 * months later as a recap arriving at the wrong hour.
 */
export async function setUserTimeZone(userId: string, timezone: string): Promise<string> {
  const tz = (timezone ?? "").trim();
  if (!isValidTimeZone(tz)) {
    throw new Error(`"${tz}" is not a time zone this system recognises.`);
  }
  await query(`update users set timezone = $2 where id = $1`, [userId, tz]);
  return tz;
}

export async function setUserRecapOptOut(userId: string, optedOut: boolean): Promise<void> {
  await query(`update users set recap_opt_out = $2 where id = $1`, [userId, optedOut === true]);
}

export { DEFAULT_TIMEZONE };
