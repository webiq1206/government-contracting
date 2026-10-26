/**
 * The account clock for outreach business hours, and the hybrid send zone.
 *
 * organizations.timezone stores an IANA name (America/New_York,
 * America/Chicago, America/Denver, America/Los_Angeles, America/Boise, and
 * any other name Intl accepts). Null means the account has not chosen.
 *
 * A send resolves in this order:
 *   1. The subcontractor's stored state and city, when that location is one
 *      solid US zone. Address lines, notes, websites, and job sites are not
 *      read, and a split state without a known city is not guessed.
 *   2. This account's organizations.timezone.
 *   3. America/Boise.
 *
 * That fallback is documented here and in
 * db/migrations/141_organization_timezone.sql. It is not UTC, not the
 * worker's zone, and not the recap default America/Denver. Personal recap
 * zones stay on users.timezone and do not open or close this gate.
 */
import { query, queryOne } from "../db";
import {
  isRecognizedTimeZone,
  resolveOutreachSendTimeZone,
} from "./outreach-send-window";
import {
  recipientTimeZoneFromLocation,
  resolveHybridOutreachZone,
} from "./recipient-timezone";

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

/**
 * The zone for one outreach, RFQ, sources-sought, or backlink send.
 *
 * Pass state and city with locationLoaded when the caller already selected
 * subcontractors.state and subcontractors.city. Otherwise a subcontractor id
 * loads those two columns for this org only. No row, no state, or a split
 * state whose city is not on the map leaves the recipient zone unset, and
 * the account zone (then America/Boise) decides.
 */
export async function outreachSendZoneFor(input: {
  orgId?: string | null;
  subcontractorId?: string | null;
  state?: string | null;
  city?: string | null;
  locationLoaded?: boolean;
}): Promise<string> {
  const orgId = input.orgId ?? null;
  let state = input.state ?? null;
  let city = input.city ?? null;
  if (!input.locationLoaded && input.subcontractorId && orgId) {
    const located = await queryOne<{ state: string | null; city: string | null }>(
      `select state, city from subcontractors where id = $1 and org_id = $2`,
      [input.subcontractorId, orgId]
    );
    state = located?.state ?? null;
    city = located?.city ?? null;
  }
  const recipientZone = recipientTimeZoneFromLocation({ state, city });
  if (recipientZone) return resolveHybridOutreachZone({ recipientZone, accountZone: null });
  let accountZone: string | null = null;
  if (orgId) {
    const account = await queryOne<{ timezone: string | null }>(
      `select timezone from organizations where id = $1`,
      [orgId]
    );
    accountZone = account?.timezone ?? null;
  }
  return resolveHybridOutreachZone({ recipientZone: null, accountZone });
}
