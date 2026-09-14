/**
 * Connected-app sync: deadlines onto calendars, updates into channels and
 * webhooks. Runs every fifteen minutes for every active organization.
 *
 * Everything is keyed so repetition is harmless: one calendar event per
 * opportunity deadline (updated in place, removed when the bid is passed),
 * one channel message per activity row, one webhook delivery per event per
 * webhook. A provider that refuses a grant marks the connection as needing
 * attention and is skipped until somebody reconnects it; nothing is
 * silently dropped.
 */
import type { AgentDefinition, AgentResult } from "./types";
import { query } from "../db";
import { config } from "../config";
import { runWithOrg } from "../tenant-context";
import { orgsToSweep } from "./org-fanout";
import { activeServices, isAuthFailure, markServiceError, markSynced, type ServiceRow } from "../connected-services";
import { upsertEvent, deleteEvent } from "../integrations/calendar-sync";
import { postChannelMessage } from "../integrations/team-notify";
import { deliverDueWebhooks, queueWebhookEvent } from "../webhooks";
import { deadlineEvent, eventKeyFor, notificationText, type DeadlineEventInput, type LedgerEvent } from "../domain/connected-services";

const CALENDAR_PROVIDERS = ["google_calendar", "microsoft_calendar"] as const;
const CHANNEL_PROVIDERS = ["slack", "teams"] as const;
const MAX_EVENTS_PER_RUN = 100;
const MAX_MESSAGES_PER_RUN = 40;

async function failureFor(row: ServiceRow, err: unknown, what: string): Promise<string> {
  const message = (err as Error).message ?? String(err);
  if (isAuthFailure(err)) {
    await markServiceError(row.id, `${row.account_label ?? "The account"} no longer accepts Brost Co (${what}). Reconnect to continue.`);
  } else {
    await markServiceError(row.id, `${what} failed: ${message}`);
  }
  return message;
}

/** Deadlines of pursued work, one event each, on every connected calendar. */
export async function syncCalendars(orgId: string): Promise<{ upserted: number; removed: number; errors: number }> {
  const out = { upserted: 0, removed: 0, errors: 0 };
  const rows = (await activeServices(orgId)).filter((r) => (CALENDAR_PROVIDERS as readonly string[]).includes(r.provider));
  if (rows.length === 0) return out;
  const opps = await query<DeadlineEventInput>(
    `select id, title, agency, solicitation_number, deadline, stage, status, pursuit_state
       from opportunities
      where org_id=$1 and deadline is not null
        and deadline > now() - interval '1 day'
        and ((status='open' and coalesce(pursuit_state,'active') <> 'aborted' and stage not in ('monitoring','scoring','dismissed'))
             or exists (select 1 from connected_service_items i where i.org_id=$1 and i.kind='calendar_event' and i.local_key = 'opportunity:'||opportunities.id::text||':deadline' and i.status='synced'))
      order by deadline
      limit $2`,
    [orgId, MAX_EVENTS_PER_RUN]
  );
  for (const row of rows) {
    const items = await query<{ local_key: string; remote_id: string | null; fingerprint: string | null; status: string }>(
      `select local_key, remote_id, fingerprint, status from connected_service_items where service_id=$1 and kind='calendar_event'`,
      [row.id]
    );
    const byKey = new Map(items.map((i) => [i.local_key, i]));
    let touched = false;
    for (const opp of opps) {
      const ev = deadlineEvent(opp, config.appUrl);
      const item = byKey.get(ev.localKey);
      try {
        if (ev.cancelled) {
          if (item?.remote_id && item.status === "synced") {
            await deleteEvent(row, item.remote_id);
            await query(`update connected_service_items set status='removed', fingerprint=$3, synced_at=now(), last_error=null where service_id=$1 and kind='calendar_event' and local_key=$2`, [row.id, ev.localKey, ev.fingerprint]);
            out.removed++;
            touched = true;
          }
          continue;
        }
        if (item && item.status === "synced" && item.fingerprint === ev.fingerprint) continue;
        const remoteId = await upsertEvent(row, ev, item?.status === "synced" ? item.remote_id : null);
        await query(
          `insert into connected_service_items (service_id, org_id, kind, local_key, remote_id, fingerprint, status, synced_at, last_error)
           values ($1,$2,'calendar_event',$3,$4,$5,'synced',now(),null)
           on conflict (service_id, kind, local_key) do update set remote_id=excluded.remote_id, fingerprint=excluded.fingerprint, status='synced', synced_at=now(), last_error=null`,
          [row.id, orgId, ev.localKey, remoteId, ev.fingerprint]
        );
        out.upserted++;
        touched = true;
      } catch (err) {
        out.errors++;
        const message = await failureFor(row, err, "Calendar sync");
        await query(
          `insert into connected_service_items (service_id, org_id, kind, local_key, status, last_error, synced_at)
           values ($1,$2,'calendar_event',$3,'failed',$4,now())
           on conflict (service_id, kind, local_key) do update set status='failed', last_error=excluded.last_error, synced_at=now()`,
          [row.id, orgId, ev.localKey, message.slice(0, 500)]
        );
        if (isAuthFailure(err)) break; // the rest will fail the same way
      }
    }
    if (touched) await markSynced(row.id);
  }
  return out;
}

/** New activity, fanned out to channels and webhooks that asked for it. */
export async function fanOutActivity(orgId: string): Promise<{ messages: number; webhooks: number; errors: number }> {
  const out = { messages: 0, webhooks: 0, errors: 0 };
  const channels = (await activeServices(orgId)).filter((r) => (CHANNEL_PROVIDERS as readonly string[]).includes(r.provider));
  const hooks = await query<{ n: number }>(`select count(*)::int as n from outbound_webhooks where org_id=$1 and active`, [orgId]);
  if (channels.length === 0 && (hooks[0]?.n ?? 0) === 0) return out;

  const cursor = await query<{ after_id: string }>(`select after_id from connected_service_cursors where org_id=$1 and purpose='notify'`, [orgId]);
  let afterId = cursor[0]?.after_id ?? null;
  if (afterId == null) {
    // First run: start from now rather than replaying the whole history into a channel.
    const latest = await query<{ id: string }>(`select max(id)::text as id from activity_events where org_id=$1`, [orgId]);
    afterId = latest[0]?.id ?? "0";
    await query(`insert into connected_service_cursors (org_id, purpose, after_id) values ($1,'notify',$2) on conflict (org_id, purpose) do nothing`, [orgId, afterId]);
    return out;
  }
  const events = await query<LedgerEvent>(
    `select id::text as id, category, status, title, actor, occurred_at, opportunity_id, detail
       from activity_events
      where org_id=$1 and id > $2::bigint and not historical
      order by id
      limit $3`,
    [orgId, afterId, MAX_MESSAGES_PER_RUN]
  );
  let last = afterId;
  for (const e of events) {
    last = String(e.id);
    const key = eventKeyFor(e);
    if (!key) continue;
    const text = notificationText(e, config.appUrl);
    for (const ch of channels) {
      const wanted = Array.isArray(ch.settings?.events) ? (ch.settings.events as string[]) : [];
      if (!wanted.includes(key)) continue;
      const localKey = `activity:${e.id}`;
      const already = await query<{ id: number }>(`select id from connected_service_items where service_id=$1 and kind='notification' and local_key=$2 and status='synced'`, [ch.id, localKey]);
      if (already.length > 0) continue;
      try {
        await postChannelMessage(ch, text);
        await query(
          `insert into connected_service_items (service_id, org_id, kind, local_key, status, synced_at) values ($1,$2,'notification',$3,'synced',now())
           on conflict (service_id, kind, local_key) do update set status='synced', synced_at=now(), last_error=null`,
          [ch.id, orgId, localKey]
        );
        await markSynced(ch.id);
        out.messages++;
      } catch (err) {
        out.errors++;
        await failureFor(ch, err, "Channel message");
      }
    }
    out.webhooks += await queueWebhookEvent(orgId, key, `activity:${e.id}`, {
      category: e.category,
      status: e.status,
      title: e.title,
      actor: e.actor,
      occurred_at: e.occurred_at,
      opportunity_id: e.opportunity_id,
      opportunity_url: e.opportunity_id ? `${config.appUrl}/opportunity/${e.opportunity_id}` : null,
      detail: e.detail,
    });
  }
  await query(`update connected_service_cursors set after_id=$2, updated_at=now() where org_id=$1 and purpose='notify'`, [orgId, last]);
  return out;
}

export const serviceSync: AgentDefinition = {
  name: "service-sync",
  label: "Connected Apps Sync",
  description: "Keeps bid deadlines on connected calendars, sends chosen updates to Slack and Teams channels, and delivers outbound webhooks with retries.",
  cron: "*/15 * * * *",
  worksWithoutClaude: true,
  async handler(): Promise<AgentResult> {
    const fanout = await orgsToSweep("service-sync");
    if (fanout.error) return { ok: false, summary: "No accounts were processed: the organization list could not be read." };
    const totals = { events: 0, removed: 0, messages: 0, webhooks: 0, errors: 0 };
    for (const org of fanout.orgs) {
      await runWithOrg(org.id, async () => {
        const cal = await syncCalendars(org.id).catch((e) => {
          console.error("[service-sync] calendar sync failed", org.id, (e as Error).message);
          return { upserted: 0, removed: 0, errors: 1 };
        });
        const fan = await fanOutActivity(org.id).catch((e) => {
          console.error("[service-sync] fan-out failed", org.id, (e as Error).message);
          return { messages: 0, webhooks: 0, errors: 1 };
        });
        totals.events += cal.upserted;
        totals.removed += cal.removed;
        totals.messages += fan.messages;
        totals.webhooks += fan.webhooks;
        totals.errors += cal.errors + fan.errors;
      });
    }
    const hooks = await deliverDueWebhooks().catch((e) => {
      console.error("[service-sync] webhook delivery failed", (e as Error).message);
      return { delivered: 0, failed: 0, abandoned: 0 };
    });
    return {
      ok: totals.errors === 0,
      summary: `Calendar events: ${totals.events} updated, ${totals.removed} removed. Channel messages: ${totals.messages}. Webhooks: ${totals.webhooks} queued, ${hooks.delivered} delivered, ${hooks.failed} retrying, ${hooks.abandoned} abandoned.${totals.errors ? ` ${totals.errors} connection error(s); affected connections are marked on the Integrations page.` : ""}`,
      data: { ...totals, ...hooks },
    };
  },
};
