import { createHash } from "node:crypto";
import { queryOne } from "../db";
import { config } from "../config";

/** Share one allowance across workers and organizations using the same inbox.
 * 2,500 units per fixed minute means at most 5,000 in any rolling minute,
 * leaving room below Google's 6,000-unit user quota. No worker sleeps here.
 * https://developers.google.com/workspace/gmail/api/reference/quota */
export async function reserveGmailQuota(orgId: string, units: number): Promise<void> {
  if (!Number.isInteger(units) || units < 1 || units > 2500) throw new Error("Invalid Gmail quota reservation");
  const inbox = await queryOne<{ email: string | null }>(
    "select email from integration_tokens where provider='gmail' and org_id=$1", [orgId],
  );
  const identity = inbox?.email?.trim().toLowerCase() || orgId;
  const key = createHash("sha256").update(`${config.gmail.clientId}:${identity}`).digest("hex");
  const admitted = await queryOne<{ units: number }>(`insert into gmail_quota_windows(mailbox_key,window_start,units)
    values($1,date_trunc('minute',clock_timestamp()),$2)
    on conflict(mailbox_key) do update set
      window_start=date_trunc('minute',clock_timestamp()),
      units=case when gmail_quota_windows.window_start < date_trunc('minute',clock_timestamp())
                 then excluded.units else gmail_quota_windows.units+excluded.units end
    where gmail_quota_windows.window_start < date_trunc('minute',clock_timestamp())
       or gmail_quota_windows.units+excluded.units <= 2500
    returning units`, [key, units]);
  if (!admitted) throw new Error("Gmail rate limit: inbox work is waiting for the next minute. Your connection is still saved; no reconnect is needed.");
}
