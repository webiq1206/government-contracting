import { createHash } from "node:crypto";
import { queryOne, transaction } from "../db";
import { config } from "../config";

/** Share one allowance across workers and organizations using the same inbox.
 * 2,500 units per fixed minute means at most 5,000 in any rolling minute,
 * leaving room below Google's 6,000-unit user quota. No worker sleeps here.
 * https://developers.google.com/workspace/gmail/api/reference/quota */
export async function reserveGmailQuota(orgId: string, units: number, step = units): Promise<number> {
  if (!Number.isInteger(units) || units < 1 || units > 2500) throw new Error("Invalid Gmail quota reservation");
  if (!Number.isInteger(step) || step < 1 || step > units || units % step !== 0) throw new Error("Invalid Gmail quota step");
  const inbox = await queryOne<{ email: string | null }>(
    "select email from integration_tokens where provider='gmail' and org_id=$1", [orgId],
  );
  const identity = inbox?.email?.trim().toLowerCase() || orgId;
  const key = createHash("sha256").update(`${config.gmail.clientId}:${identity}`).digest("hex");
  return transaction(async client => {
    await client.query(`insert into gmail_quota_windows(mailbox_key,window_start,units)
      values($1,date_trunc('minute',clock_timestamp()),0) on conflict(mailbox_key) do nothing`, [key]);
    const current = await client.query<{ available: number }>(`select case
      when window_start < date_trunc('minute',clock_timestamp()) then 2500 else 2500-units end as available
      from gmail_quota_windows where mailbox_key=$1 for update`, [key]);
    const grant = Math.min(units, Math.floor(current.rows[0].available / step) * step);
    if (grant < step) throw new Error("Gmail rate limit: inbox work is waiting for the next minute. Your connection is still saved; no reconnect is needed.");
    await client.query(`update gmail_quota_windows set
      units=case when window_start < date_trunc('minute',clock_timestamp()) then $2 else units+$2 end,
      window_start=date_trunc('minute',clock_timestamp()) where mailbox_key=$1`, [key, grant]);
    return grant;
  });
}
