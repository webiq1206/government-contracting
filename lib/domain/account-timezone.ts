/**
 * The account clock for outreach business hours.
 *
 * Stored on organizations.timezone as an IANA name (America/New_York,
 * America/Chicago, America/Denver, America/Los_Angeles, America/Boise, and
 * any other name Intl accepts). Null means the account has not chosen.
 *
 * Readers fall back to America/Boise. That fallback is documented here and
 * in db/migrations/141_organization_timezone.sql. It is not UTC, not the
 * worker's zone, and not the recap default America/Denver. Personal recap
 * zones stay on users.timezone and do not open or close this gate.
 */
import { query, queryOne } from "../db";
import {
  isRecognizedTimeZone,
  resolveOutreachSendTimeZone,
} from "./outreach-send-window";

/** The zone this account's outreach must use. Missing and invalid rows use America/Boise. */
export async function accountOutreachTimeZone(orgId: string | null | undefined): Promise<string> {
  if (!orgId) return resolveOutreachSendTimeZone(null);
  const row = await queryOne<{ timezone: string | null }>(
    `select timezone from organizations where id = $1`,
    [orgId]
  );
  return resolveOutreachSendTimeZone(row?.timezone);
}

/**
 * Store the account's IANA zone.
 *
 * An unrecognised name is refused and the column is left as it was. A blank
 * value is not a way to clear the zone: unset stays null until someone
 * chooses, and null already means America/Boise.
 */
export async function setAccountTimeZone(orgId: string, timezone: string): Promise<string> {
  const tz = (timezone ?? "").trim();
  if (!isRecognizedTimeZone(tz)) {
    throw new Error(
      `"${tz}" is not an IANA time zone this system recognises. The account's send window was not changed.`
    );
  }
  const canonical = resolveOutreachSendTimeZone(tz);
  await query(
    `update organizations set timezone = $2, updated_at = now() where id = $1`,
    [orgId, canonical]
  );
  return canonical;
}
