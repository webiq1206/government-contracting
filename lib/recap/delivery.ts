/**
 * The record of what was sent, and the guard against sending it twice.
 *
 * Every morning send goes through `claimDelivery` first. The claim is an
 * insert against a unique index, so two workers, a restart mid-send, or a
 * scheduler that fires twice in the same minute all collide on one row rather
 * than producing two emails. The row is created before the mail is built,
 * which means a crash between claiming and sending leaves a visible pending
 * row somebody can retry, not a silent gap.
 *
 * The rendered copy is stored with the row on purpose. "What did it say" and
 * "send it again" are the only two questions ever asked about a recap that
 * went astray, and rebuilding it from the current records answers neither:
 * the deadline has passed, the reply was answered, the numbers have moved.
 */
import { query, queryOne } from "../db";

export type RecapDeliveryStatus = "pending" | "sent" | "failed" | "bounced";

export interface RecapDelivery {
  id: string;
  orgId: string | null;
  userId: string | null;
  recipientEmail: string;
  scope: "org" | "platform";
  localDate: string;
  timezone: string;
  status: RecapDeliveryStatus;
  late: boolean;
  quiet: boolean;
  test: boolean;
  dueAt: string | null;
  sentAt: string | null;
  /** When the mail was handed to the provider. See `markAttempting`. */
  providerAttemptedAt: string | null;
  attempts: number;
  urgentCount: number;
  subject: string | null;
  html: string | null;
  textBody: string | null;
  providerMessageId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

const COLUMNS = `id, org_id, user_id, recipient_email, scope, local_date::text as local_date,
                 timezone, status, late, quiet, test, due_at, sent_at, provider_attempted_at,
                 attempts, urgent_count,
                 subject, html, text_body, provider_message_id, error, created_at, updated_at`;

function toDelivery(r: Record<string, unknown>): RecapDelivery {
  const at = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null) ?? null);
  return {
    id: String(r.id),
    orgId: (r.org_id as string) ?? null,
    userId: (r.user_id as string) ?? null,
    recipientEmail: String(r.recipient_email),
    scope: (r.scope as "org" | "platform") ?? "org",
    localDate: String(r.local_date),
    timezone: String(r.timezone),
    status: (r.status as RecapDeliveryStatus) ?? "pending",
    late: r.late === true,
    quiet: r.quiet === true,
    test: r.test === true,
    dueAt: at(r.due_at),
    sentAt: at(r.sent_at),
    providerAttemptedAt: at(r.provider_attempted_at),
    attempts: Number(r.attempts ?? 0),
    urgentCount: Number(r.urgent_count ?? 0),
    subject: (r.subject as string) ?? null,
    html: (r.html as string) ?? null,
    textBody: (r.text_body as string) ?? null,
    providerMessageId: (r.provider_message_id as string) ?? null,
    error: (r.error as string) ?? null,
    createdAt: at(r.created_at) ?? new Date(0).toISOString(),
    updatedAt: at(r.updated_at) ?? new Date(0).toISOString(),
  };
}

export interface ClaimInput {
  orgId: string | null;
  userId: string | null;
  recipientEmail: string;
  scope: "org" | "platform";
  localDate: string;
  timezone: string;
  dueAt: Date | null;
  late: boolean;
  test?: boolean;
}

export interface ClaimResult {
  /** The row to send against, or null when somebody else already has it. */
  delivery: RecapDelivery | null;
  /** Why nothing is to be done: the send already happened, or is in flight. */
  reason?: "already-sent" | "in-flight";
  existing?: RecapDelivery;
}

/**
 * Take ownership of one recipient's send for one local day.
 *
 * A test send skips the uniqueness rule entirely (the index excludes it), so
 * rehearsing the mail never consumes the real morning's slot.
 *
 * A failed row is re-claimable: the provider refused it, so no mail exists and
 * sending again cannot duplicate anything. A row already sent is not, and a
 * pending row younger than the stall window is not either, because a second
 * worker finding one mid-send should stand down rather than race it.
 *
 * The subtle case is a pending row that has gone stale. It means a worker
 * died mid-send, and whether that is safe to redo depends entirely on how far
 * it got. `provider_attempted_at` is written immediately before the provider
 * is called, so:
 *
 *   - stamp absent: nothing was handed to the provider, no mail can exist, and
 *     this reclaims the row and sends.
 *   - stamp present: the provider may well have accepted it. Sending again
 *     would be the duplicate this whole table exists to prevent, so automation
 *     stops here and the row waits for a person, who can see it in the history
 *     and press retry.
 *
 * `MAX_AUTOMATIC_ATTEMPTS` stops a permanently failing address from being
 * re-attempted every fifteen minutes all morning.
 */
export const MAX_AUTOMATIC_ATTEMPTS = 3;
export async function claimDelivery(input: ClaimInput): Promise<ClaimResult> {
  const email = input.recipientEmail.trim();
  const test = input.test === true;

  if (test) {
    const rows = await query<Record<string, unknown>>(
      `insert into recap_deliveries
         (org_id, user_id, recipient_email, scope, local_date, timezone, due_at, late, test,
          status, attempts)
       values ($1, $2, $3, $4, $5::date, $6, $7, $8, true, 'pending', 1)
       returning ${COLUMNS}`,
      [
        input.orgId,
        input.userId,
        email,
        input.scope,
        input.localDate,
        input.timezone,
        input.dueAt?.toISOString() ?? null,
        input.late,
      ]
    );
    return { delivery: toDelivery(rows[0]!) };
  }

  /*
   * Fifteen minutes is the stall window, matching the scheduler's tick: a
   * pending row older than that belonged to a worker that is not coming back.
   */
  const rows = await query<Record<string, unknown>>(
    `insert into recap_deliveries
       (org_id, user_id, recipient_email, scope, local_date, timezone, due_at, late,
        status, attempts)
     values ($1, $2, $3, $4, $5::date, $6, $7, $8, 'pending', 1)
     on conflict (
       coalesce(org_id, '00000000-0000-4000-8000-000000000000'::uuid),
       lower(recipient_email), local_date, scope
     ) where test = false
     do update
       set attempts = recap_deliveries.attempts + 1,
           status = 'pending',
           error = null,
           late = recap_deliveries.late or excluded.late,
           due_at = coalesce(recap_deliveries.due_at, excluded.due_at),
           updated_at = now()
     where recap_deliveries.attempts < ${MAX_AUTOMATIC_ATTEMPTS}
       and (
         recap_deliveries.status = 'failed'
         or (recap_deliveries.status = 'pending'
             and recap_deliveries.provider_attempted_at is null
             and recap_deliveries.updated_at < now() - interval '15 minutes')
       )
     returning ${COLUMNS}`,
    [
      input.orgId,
      input.userId,
      email,
      input.scope,
      input.localDate,
      input.timezone,
      input.dueAt?.toISOString() ?? null,
      input.late,
    ]
  );

  if (rows.length > 0) return { delivery: toDelivery(rows[0]!) };

  // The insert was blocked by the `where` on the update, so a row exists and
  // is not ours to take. Read it back to say which case it was.
  const existing = await findDelivery({
    orgId: input.orgId,
    recipientEmail: email,
    localDate: input.localDate,
    scope: input.scope,
  });
  return {
    delivery: null,
    reason: existing?.status === "pending" ? "in-flight" : "already-sent",
    existing: existing ?? undefined,
  };
}

/**
 * Write down that the provider is about to be handed this mail.
 *
 * Called immediately before the send, never after. If the process dies in the
 * next second, this stamp is the difference between "send it again" and "ask a
 * person", and a stamp written afterwards would be no stamp at all in exactly
 * the case it exists for.
 */
export async function markAttempting(id: string): Promise<void> {
  await query(
    `update recap_deliveries
        set provider_attempted_at = now(), updated_at = now()
      where id = $1`,
    [id]
  );
}

export async function findDelivery(input: {
  orgId: string | null;
  recipientEmail: string;
  localDate: string;
  scope: "org" | "platform";
}): Promise<RecapDelivery | null> {
  const row = await queryOne<Record<string, unknown>>(
    `select ${COLUMNS} from recap_deliveries
      where coalesce(org_id, '00000000-0000-4000-8000-000000000000'::uuid)
            = coalesce($1::uuid, '00000000-0000-4000-8000-000000000000'::uuid)
        and lower(recipient_email) = lower($2)
        and local_date = $3::date
        and scope = $4
        and test = false`,
    [input.orgId, input.recipientEmail, input.localDate, input.scope]
  );
  return row ? toDelivery(row) : null;
}

export async function getDelivery(id: string): Promise<RecapDelivery | null> {
  const row = await queryOne<Record<string, unknown>>(
    `select ${COLUMNS} from recap_deliveries where id = $1`,
    [id]
  );
  return row ? toDelivery(row) : null;
}

/** The rendered copy is written with the outcome, in one statement, always. */
export async function markSent(
  id: string,
  data: {
    subject: string;
    html: string;
    text: string;
    quiet: boolean;
    urgentCount: number;
    providerMessageId?: string | null;
  }
): Promise<void> {
  await query(
    `update recap_deliveries
        set status = 'sent', sent_at = now(), error = null,
            subject = $2, html = $3, text_body = $4,
            quiet = $5, urgent_count = $6, provider_message_id = $7,
            updated_at = now()
      where id = $1`,
    [id, data.subject, data.html, data.text, data.quiet, data.urgentCount, data.providerMessageId ?? null]
  );
}

/**
 * A send that did not happen.
 *
 * The rendered copy is kept even on failure: the retry should send the mail
 * that was written for that morning, not a fresh one describing a day that has
 * since moved on.
 */
export async function markFailed(
  id: string,
  error: string,
  rendered?: { subject: string; html: string; text: string; quiet: boolean; urgentCount: number }
): Promise<void> {
  await query(
    `update recap_deliveries
        set status = 'failed', error = $2, updated_at = now(),
            subject = coalesce($3, subject),
            html = coalesce($4, html),
            text_body = coalesce($5, text_body),
            quiet = coalesce($6, quiet),
            urgent_count = coalesce($7, urgent_count)
      where id = $1`,
    [
      id,
      error.slice(0, 2000),
      rendered?.subject ?? null,
      rendered?.html ?? null,
      rendered?.text ?? null,
      rendered?.quiet ?? null,
      rendered?.urgentCount ?? null,
    ]
  );
}

/**
 * Nothing happened, and the account asked not to hear about it.
 *
 * Recorded rather than skipped silently. The row is what stops the next tick
 * fifteen minutes later from rebuilding the same empty recap and reconsidering
 * it, and it is also the answer to "why did I not get one on Sunday": the
 * history shows the morning, marked quiet, with no mail sent. A skipped
 * morning keeps a null subject, which is how the history tells it apart from
 * a short recap that really was delivered.
 */
export async function markSkipped(id: string, reason: string): Promise<void> {
  await query(
    `update recap_deliveries
        set status = 'sent', sent_at = now(), quiet = true, urgent_count = 0,
            subject = null, html = null, text_body = null,
            error = $2, updated_at = now()
      where id = $1`,
    [id, reason.slice(0, 500)]
  );
}

export async function markBounced(id: string, detail: string): Promise<void> {
  await query(
    `update recap_deliveries
        set status = 'bounced', error = $2, updated_at = now()
      where id = $1`,
    [id, detail.slice(0, 2000)]
  );
}

/** The most recent send to this address, for matching a bounce back to it. */
export async function recentDeliveryTo(
  email: string,
  withinHours = 72
): Promise<RecapDelivery | null> {
  const row = await queryOne<Record<string, unknown>>(
    `select ${COLUMNS} from recap_deliveries
      where lower(recipient_email) = lower($1)
        and status = 'sent'
        and sent_at > now() - ($2 || ' hours')::interval
      order by sent_at desc limit 1`,
    [email, String(withinHours)]
  );
  return row ? toDelivery(row) : null;
}

export interface HistoryFilter {
  orgId: string | null;
  scope?: "org" | "platform";
  limit?: number;
  includeTests?: boolean;
}

export async function deliveryHistory(f: HistoryFilter): Promise<RecapDelivery[]> {
  const limit = Math.min(Math.max(f.limit ?? 30, 1), 200);
  const rows = await query<Record<string, unknown>>(
    `select ${COLUMNS} from recap_deliveries
      where coalesce(org_id, '00000000-0000-4000-8000-000000000000'::uuid)
            = coalesce($1::uuid, '00000000-0000-4000-8000-000000000000'::uuid)
        and ($2::text is null or scope = $2)
        and ($3::boolean or test = false)
      order by created_at desc
      limit ${limit}`,
    [f.orgId, f.scope ?? null, f.includeTests === true]
  );
  return rows.map(toDelivery);
}

/**
 * Put a row back in the queue for one deliberate resend.
 *
 * Failed and bounced rows qualify, and so does a pending one that has been
 * stuck past the stall window: that is the row automation refuses to touch
 * because the provider may already have it, and a person looking at the
 * history is exactly who should decide whether to risk a second copy.
 *
 * Conditional update rather than read-then-write, so two admins pressing the
 * button at the same moment produce one email.
 */
export async function reopenForRetry(id: string, orgId: string | null): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `update recap_deliveries
        set status = 'pending', error = null, attempts = attempts + 1,
            provider_attempted_at = null, updated_at = now()
      where id = $1
        and coalesce(org_id, '00000000-0000-4000-8000-000000000000'::uuid)
            = coalesce($2::uuid, '00000000-0000-4000-8000-000000000000'::uuid)
        and (
          status in ('failed', 'bounced')
          or (status = 'pending' and updated_at < now() - interval '15 minutes')
        )
      returning id`,
    [id, orgId]
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// How long an item has been urgent
// ---------------------------------------------------------------------------

/**
 * Record today's urgent items and answer how long each has been urgent.
 *
 * One statement, upserting every key at once, returning the first morning each
 * was seen. Ages come back in whole days from that first morning, so an item
 * first shown yesterday reads as one day old.
 *
 * Keys that stop appearing are left in place rather than deleted. They cost
 * almost nothing, and a problem that comes back a week later having kept its
 * original age is more honest than one that resets to new because somebody
 * cleared it briefly. Rows untouched for a season are swept below.
 */
export async function recordUrgentItems(
  orgId: string,
  keys: string[],
  localDate: string
): Promise<Record<string, number>> {
  if (keys.length === 0) return {};
  const unique = [...new Set(keys)];

  const rows = await query<{ item_key: string; age_days: number }>(
    `insert into recap_urgent_items (org_id, item_key, first_seen_on, last_seen_on)
     select $1, k, $2::date, $2::date from unnest($3::text[]) as k
     on conflict (org_id, item_key) do update
       set last_seen_on = greatest(recap_urgent_items.last_seen_on, excluded.last_seen_on)
     returning item_key, ($2::date - first_seen_on)::int as age_days`,
    [orgId, localDate, unique]
  );

  const ages: Record<string, number> = {};
  for (const r of rows) ages[r.item_key] = Math.max(0, Number(r.age_days ?? 0));
  return ages;
}

/**
 * Read ages without recording anything.
 *
 * The dashboard page uses this. Viewing a recap must not age its items:
 * opening the page twice would otherwise make yesterday's problem a day older
 * than the mail said.
 */
export async function urgentAges(
  orgId: string,
  keys: string[],
  localDate: string
): Promise<Record<string, number>> {
  if (keys.length === 0) return {};
  const rows = await query<{ item_key: string; age_days: number }>(
    `select item_key, ($3::date - first_seen_on)::int as age_days
       from recap_urgent_items
      where org_id = $1 and item_key = any($2::text[])`,
    [orgId, [...new Set(keys)], localDate]
  );
  const ages: Record<string, number> = {};
  for (const r of rows) ages[r.item_key] = Math.max(0, Number(r.age_days ?? 0));
  return ages;
}

/** Drop ages for items nobody has seen in a long while. */
export async function pruneUrgentItems(orgId: string, olderThanDays = 120): Promise<number> {
  const rows = await query<{ org_id: string }>(
    `delete from recap_urgent_items
      where org_id = $1 and last_seen_on < current_date - ($2 || ' days')::interval
      returning org_id`,
    [orgId, String(olderThanDays)]
  );
  return rows.length;
}
