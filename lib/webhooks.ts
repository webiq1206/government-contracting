/**
 * Outbound webhooks: signed POSTs to Zapier, Make, or anything with a URL.
 *
 * Each webhook chooses which events it wants. A delivery row is written per
 * event per webhook before anything is sent, keyed on the event, so a retry
 * never turns into a second copy; failures back off and are abandoned after
 * the last retry with the reason kept on the row.
 */
import { randomBytes } from "node:crypto";
import { query, queryOne } from "./db";
import { encryptSecret, decryptSecret } from "./integration-settings";
import { guardedFetch, GuardedFetchError } from "./integrations/guarded-fetch";
import { config } from "./config";
import { NOTIFY_EVENT_KEYS, nextRetryAt, signWebhook } from "./domain/connected-services";

export interface WebhookRow {
  id: string;
  org_id: string;
  label: string;
  url: string;
  secret_enc: string;
  events: string[];
  active: boolean;
  created_by: string | null;
  last_status: string | null;
  last_delivered_at: string | null;
  failure_count: number;
  created_at: string;
}

export function acceptableWebhookTarget(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && /\./.test(u.hostname);
  } catch {
    return false;
  }
}

export async function listWebhooks(orgId: string): Promise<WebhookRow[]> {
  return query<WebhookRow>(`select * from outbound_webhooks where org_id=$1 order by created_at`, [orgId]);
}

/** Create a webhook. The secret is returned once, here, and never shown again. */
export async function createWebhook(input: { orgId: string; createdBy: string; label: string; url: string; events: string[] }): Promise<{ row: WebhookRow; secret: string }> {
  const secret = `whsec_${randomBytes(24).toString("hex")}`;
  const events = input.events.filter((e) => NOTIFY_EVENT_KEYS.has(e));
  const row = await queryOne<WebhookRow>(
    `insert into outbound_webhooks (org_id, label, url, secret_enc, events, created_by)
     values ($1,$2,$3,$4,$5,$6) returning *`,
    [input.orgId, input.label.slice(0, 120), input.url, encryptSecret(secret), events, input.createdBy]
  );
  return { row: row!, secret };
}

export async function updateWebhook(id: string, orgId: string, patch: { label?: string; events?: string[]; active?: boolean }): Promise<void> {
  await query(
    `update outbound_webhooks
        set label = coalesce($3, label),
            events = coalesce($4, events),
            active = coalesce($5, active),
            updated_at = now()
      where id=$1 and org_id=$2`,
    [id, orgId, patch.label?.slice(0, 120) ?? null, patch.events ? patch.events.filter((e) => NOTIFY_EVENT_KEYS.has(e)) : null, patch.active ?? null]
  );
}

export async function deleteWebhook(id: string, orgId: string): Promise<void> {
  await query(`delete from outbound_webhooks where id=$1 and org_id=$2`, [id, orgId]);
}

/** Queue one event for every active webhook subscribed to it. Idempotent per event key. */
export async function queueWebhookEvent(orgId: string, event: string, eventKey: string, payload: Record<string, unknown>): Promise<number> {
  const rows = await query<{ id: string }>(
    `insert into webhook_deliveries (webhook_id, org_id, event, event_key, payload)
     select w.id, w.org_id, $2, $3, $4::jsonb
       from outbound_webhooks w
      where w.org_id=$1 and w.active and $2 = any(w.events)
     on conflict (webhook_id, event_key) do nothing
     returning id`,
    [orgId, event, eventKey, JSON.stringify(payload)]
  );
  return rows.length;
}

export interface DeliveryRow {
  id: string;
  webhook_id: string;
  org_id: string;
  event: string;
  event_key: string;
  payload: Record<string, unknown>;
  attempts: number;
}

/** Send everything that is due. Returns counts for the run log. */
export async function deliverDueWebhooks(limit = 50): Promise<{ delivered: number; failed: number; abandoned: number }> {
  const due = await query<DeliveryRow & { url: string; secret_enc: string; active: boolean }>(
    `select d.*, w.url, w.secret_enc, w.active
       from webhook_deliveries d
       join outbound_webhooks w on w.id = d.webhook_id
      where d.status='pending' and d.next_attempt_at <= now()
      order by d.next_attempt_at
      limit $1`,
    [limit]
  );
  let delivered = 0;
  let failed = 0;
  let abandoned = 0;
  for (const d of due) {
    if (!d.active) {
      await query(`update webhook_deliveries set status='abandoned', last_error='Webhook was turned off.' where id=$1`, [d.id]);
      abandoned++;
      continue;
    }
    const body = JSON.stringify({
      id: d.id,
      event: d.event,
      occurred_at: (d.payload.occurred_at as string) ?? new Date().toISOString(),
      data: d.payload,
      source: config.appUrl,
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const secret = decryptSecret(d.secret_enc) ?? "";
    const signature = signWebhook(secret, timestamp, body);
    const attempts = d.attempts + 1;
    try {
      const res = await guardedFetch(d.url, {
        maxBytes: 64 * 1024,
        timeoutMs: 15_000,
        maxRedirects: 0,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-brostco-event": d.event,
          "x-brostco-timestamp": timestamp,
          "x-brostco-signature": `v1=${signature}`,
        },
        body,
      });
      await query(
        `update webhook_deliveries set status='delivered', attempts=$2, delivered_at=now(), response_status=200, last_error=null where id=$1`,
        [d.id, attempts]
      );
      await query(`update outbound_webhooks set last_status='ok', last_delivered_at=now(), failure_count=0, updated_at=now() where id=$1`, [d.webhook_id]);
      void res;
      delivered++;
    } catch (err) {
      const status = err instanceof GuardedFetchError ? err.status : null;
      const message = (err as Error).message.slice(0, 500);
      const next = nextRetryAt(attempts);
      if (next) {
        await query(`update webhook_deliveries set attempts=$2, next_attempt_at=$3, response_status=$4, last_error=$5 where id=$1`, [d.id, attempts, next, status, message]);
        failed++;
      } else {
        await query(`update webhook_deliveries set status='abandoned', attempts=$2, response_status=$3, last_error=$4 where id=$1`, [d.id, attempts, status, message]);
        abandoned++;
      }
      await query(`update outbound_webhooks set last_status=$2, failure_count=failure_count+1, updated_at=now() where id=$1`, [d.webhook_id, `failed: ${message}`.slice(0, 200)]);
    }
  }
  return { delivered, failed, abandoned };
}

/** Recent deliveries for the settings page. */
export async function recentDeliveries(webhookId: string, orgId: string, limit = 10) {
  return query<{ id: string; event: string; status: string; attempts: number; response_status: number | null; last_error: string | null; created_at: string; delivered_at: string | null }>(
    `select id, event, status, attempts, response_status, last_error, created_at, delivered_at
       from webhook_deliveries where webhook_id=$1 and org_id=$2 order by created_at desc limit $3`,
    [webhookId, orgId, limit]
  );
}
