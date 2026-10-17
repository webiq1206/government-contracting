/**
 * Claim one quote-request slot before the mailbox is called.
 *
 * Counting mail and then sending lets every parallel job read the same
 * number and all of them send. The account's row for this UTC day is locked,
 * the count of accepted mail plus claims still in flight is read, and the
 * claim is inserted before that lock is released.
 */
import type { PoolClient } from "pg";
import { tenantTransaction } from "../db";

const EXCLUDED_KINDS = "('decline_thank_you','final_nudge','clarification','compliance-chase')";

export const RFQ_SLOT_LOCK_SQL = `insert into rfq_daily_slots (org_id, utc_day)
values ($1::uuid, (now() at time zone 'UTC')::date)
on conflict (org_id, utc_day) do nothing`;

export const RFQ_SLOT_GUARD_SQL = `select utc_day
  from rfq_daily_slots
 where org_id = $1::uuid
   and utc_day = (now() at time zone 'UTC')::date
 for update`;

export const RFQ_SLOT_COUNT_SQL = `select
  (
    select count(*)::int from communications
     where org_id = $1::uuid
       and channel = 'email' and direction = 'outbound'
       and delivery_state in ('sent','delivered')
       and created_at >= (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')
       and coalesce(meta->>'kind','') not in ${EXCLUDED_KINDS}
  ) + (
    select count(*)::int from rfq_send_claims
     where org_id = $1::uuid
       and utc_day = (now() at time zone 'UTC')::date
       and state = 'reserved'
  ) as sent_today,
  (
    select count(distinct subcontractor_id)::int from (
      select subcontractor_id from communications
       where org_id = $1::uuid
         and opportunity_id = $2::uuid
         and channel = 'email' and direction = 'outbound'
         and delivery_state in ('sent','delivered')
         and coalesce(meta->>'trade','') = $3
         and coalesce(meta->>'kind','') not in ${EXCLUDED_KINDS}
      union
      select subcontractor_id from rfq_send_claims
       where org_id = $1::uuid
         and opportunity_id = $2::uuid
         and trade = $3
         and utc_day = (now() at time zone 'UTC')::date
         and state = 'reserved'
    ) subs
  ) as sent_for_trade`;

export const RFQ_SLOT_CLAIM_SQL = `insert into rfq_send_claims
  (org_id, utc_day, opportunity_id, subcontractor_id, trade, state)
values ($1::uuid, (now() at time zone 'UTC')::date, $2::uuid, $3::uuid, $4, 'reserved')
returning id`;

const RFQ_SLOT_STATE_SQL = `update rfq_send_claims
   set state = $3
 where id = $2::uuid
   and org_id = $1::uuid
   and state = 'reserved'`;

export interface RfqSlotInput {
  orgId: string;
  opportunityId: string;
  subcontractorId: string;
  trade: string;
  dailyCap: number;
  perTradeCap: number;
}

export type RfqSlotResult =
  | { ok: true; claimId: string }
  | { ok: false; reason: "daily_cap" | "trade_cap" };

async function rows<T extends Record<string, unknown>>(
  client: PoolClient,
  sql: string,
  params: unknown[]
): Promise<T[]> {
  const result = await client.query(sql, params);
  return result.rows as T[];
}

/** Reserve one slot, or refuse because the daily or per-trade cap is already taken. */
export async function reserveRfqSendSlot(input: RfqSlotInput): Promise<RfqSlotResult> {
  return tenantTransaction(input.orgId, async (client) => {
    await client.query(RFQ_SLOT_LOCK_SQL, [input.orgId]);
    await client.query(RFQ_SLOT_GUARD_SQL, [input.orgId]);
    const counted = await rows<{ sent_today: number | null; sent_for_trade: number | null }>(
      client,
      RFQ_SLOT_COUNT_SQL,
      [input.orgId, input.opportunityId, input.trade]
    );
    const sentToday = Number(counted[0]?.sent_today ?? 0);
    const sentForTrade = Number(counted[0]?.sent_for_trade ?? 0);
    if (sentToday >= input.dailyCap) return { ok: false, reason: "daily_cap" };
    if (sentForTrade >= input.perTradeCap) return { ok: false, reason: "trade_cap" };
    const claimed = await rows<{ id: string }>(client, RFQ_SLOT_CLAIM_SQL, [
      input.orgId,
      input.opportunityId,
      input.subcontractorId,
      input.trade,
    ]);
    return { ok: true, claimId: claimed[0].id };
  });
}

async function markClaim(orgId: string, claimId: string, state: "sent" | "released"): Promise<void> {
  await tenantTransaction(orgId, async (client) => {
    await client.query(RFQ_SLOT_STATE_SQL, [orgId, claimId, state]);
  });
}

/** The mailbox accepted this request, so the claim no longer counts as in flight. */
export async function settleRfqSendSlot(orgId: string, claimId: string): Promise<void> {
  await markClaim(orgId, claimId, "sent");
}

/** The send did not happen. The slot can be used by another request today. */
export async function releaseRfqSendSlot(orgId: string, claimId: string): Promise<void> {
  await markClaim(orgId, claimId, "released");
}
