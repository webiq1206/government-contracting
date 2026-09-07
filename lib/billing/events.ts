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
  /** Why a non-fresh event was refused. */
  state: "claimed" | "processing" | "completed";
}

const PROCESSING = "__processing__";

/**
 * Record an event before handling it.
 *
 * The insert is the lock. Failed claims can be reclaimed immediately, while a
 * process that died without recording its failure can be reclaimed after the
 * lease. A concurrent delivery is identified as processing rather than
 * falsely acknowledged as a completed duplicate.
 */
export async function claimEvent(input: {
  id: string;
  type: string;
  createdAtSec: number;
  orgId?: string | null;
}): Promise<ClaimResult> {
  const rows = await query<{ id: string }>(
    `insert into stripe_events (id, type, created_at, org_id, error)
     values ($1, $2, to_timestamp($3), $4, $5)
     on conflict (id) do update
       set processed_at = now(), error = excluded.error
       where stripe_events.error is not null
         and (stripe_events.error <> $5
              or stripe_events.processed_at < now() - interval '15 minutes')
     returning id`,
    [input.id, input.type, input.createdAtSec, input.orgId ?? null, PROCESSING]
  );
  if (rows.length > 0) return { fresh: true, state: "claimed" };

  const existing = await queryOne<{ error: string | null }>(
    `select error from stripe_events where id = $1`,
    [input.id]
  );
  return {
    fresh: false,
    state: existing?.error === PROCESSING ? "processing" : "completed",
  };
}

/** Attach a handler failure to the event row so it can be diagnosed later. */
export async function markEventFailed(id: string, error: string): Promise<void> {
  await query(`update stripe_events set error = $2 where id = $1`, [
    id,
    error.slice(0, 1000),
  ]);
}

/** Mark the claimed event as fully handled only after every required write. */
export async function completeEvent(id: string): Promise<void> {
  const rows = await query<{ id: string }>(
    `update stripe_events
        set error = null, processed_at = now()
      where id = $1 and error = $2
      returning id`,
    [id, PROCESSING]
  );
  if (rows.length === 0) throw new Error("Stripe event claim was lost before completion.");
}

/**
 * Release a claimed event so Stripe's retry can genuinely reprocess it.
 *
 * Called when a handler throws. Without this the claim row would survive, the
 * retry would be treated as a duplicate, and the failure would be permanent
 * while still looking like a success in the events table.
 */
export async function releaseEvent(id: string): Promise<void> {
  await query(`delete from stripe_events where id = $1`, [id]);
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
  );
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
  );
}
