/**
 * Webhook safety: process each Stripe event exactly once, and never let a late
 * one overwrite newer state.
 *
 * Stripe retries until it gets a 2xx and does not guarantee delivery order.
 * Both problems are real in practice: a retried checkout.session.completed
 * would re-run activation, and a subscription.updated delayed behind a newer
 * one would roll an account back to stale values.
 */
import { query, queryOne } from "../db";

export interface ClaimResult {
  /** False when this event was already processed and must be skipped. */
  fresh: boolean;
}

/**
 * Record an event before handling it.
 *
 * The insert is the lock: the primary key on Stripe's event id means a
 * concurrent retry conflicts rather than running the handler twice.
 */
export async function claimEvent(input: {
  id: string;
  type: string;
  createdAtSec: number;
  orgId?: string | null;
}): Promise<ClaimResult> {
  const rows = await query<{ id: string }>(
    `insert into stripe_events (id, type, created_at, org_id)
     values ($1, $2, to_timestamp($3), $4)
     on conflict (id) do nothing
     returning id`,
    [input.id, input.type, input.createdAtSec, input.orgId ?? null]
  );
  return { fresh: rows.length > 0 };
}

/** Attach a handler failure to the event row so it can be diagnosed later. */
export async function markEventFailed(id: string, error: string): Promise<void> {
  await query(`update stripe_events set error = $2 where id = $1`, [
    id,
    error.slice(0, 1000),
  ]).catch(() => {});
}

/**
 * Release a claimed event so Stripe's retry can genuinely reprocess it.
 *
 * Called when a handler throws. Without this the claim row would survive, the
 * retry would be treated as a duplicate, and the failure would be permanent
 * while still looking like a success in the events table.
 */
export async function releaseEvent(id: string): Promise<void> {
  await query(`delete from stripe_events where id = $1`, [id]).catch(() => {});
}

/**
 * Whether this event is newer than the last one applied to the organization.
 *
 * Guards against out-of-order delivery. Events that carry no subscription
 * state (an invoice notification, say) should not be ordered this way, so the
 * caller decides when to apply it.
 */
export async function isNewerThanApplied(
  orgId: string,
  createdAtSec: number
): Promise<boolean> {
  const row = await queryOne<{ billing_event_at: string | null }>(
    `select billing_event_at from organizations where id = $1`,
    [orgId]
  ).catch(() => null);
  if (!row?.billing_event_at) return true;
  return new Date(createdAtSec * 1000).getTime() >= new Date(row.billing_event_at).getTime();
}

/** Stamp the org with the timestamp of the newest event applied to it. */
export async function markApplied(orgId: string, createdAtSec: number): Promise<void> {
  await query(
    `update organizations
        set billing_event_at = greatest(
              coalesce(billing_event_at, to_timestamp(0)), to_timestamp($2))
      where id = $1`,
    [orgId, createdAtSec]
  ).catch(() => {});
}
