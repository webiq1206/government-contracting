/**
 * The Needs matching inbox.
 *
 * A subcontractor's reply to a bid invitation is a customer message. When the
 * poller cannot place it, the instruction is that it must not disappear into
 * an agent log, and the reason is worth stating plainly: an agent log is a
 * stream somebody reads when the automation is misbehaving, not a queue of
 * work. The line scrolls away, it carries no body, and the only instruction it
 * can give is "go and look in the mailbox".
 *
 * This is where those messages go instead: readable, placeable, and still
 * there tomorrow.
 */
import { query, queryOne } from "./db";

/** Enough to recognise a message and decide where it belongs. */
const SNIPPET_CHARS = 1_200;

export interface UnmatchedMessage {
  id: string;
  fromEmail: string;
  fromName: string | null;
  subject: string | null;
  snippet: string | null;
  receivedAt: Date;
  gmailThreadId: string | null;
  subcontractorId: string | null;
  subcontractorName: string | null;
  state: "needs_matching" | "matched" | "dismissed";
}

export interface RecordUnmatchedInput {
  orgId: string;
  fromEmail: string;
  fromName?: string | null;
  subject?: string | null;
  body?: string | null;
  gmailThreadId?: string | null;
  messageId?: string | null;
  receivedAt?: Date | null;
  subcontractorId?: string | null;
}

/**
 * File a message nobody could place.
 *
 * Returns the row id, or null when this message is already in the inbox. The
 * unique index does the deduplication rather than a read-then-write, because a
 * poll that restarts mid-batch is exactly the case a read-then-write loses.
 *
 * A message with no Message-ID cannot be deduplicated, so it is inserted every
 * time. That is the honest trade: a duplicate an operator can dismiss is
 * better than a reply that was dropped because it lacked a header.
 */
export async function recordUnmatched(input: RecordUnmatchedInput): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    `insert into unmatched_inbound
       (org_id, from_email, from_name, subject, snippet, gmail_thread_id, message_id,
        received_at, subcontractor_id)
     values ($1,$2,$3,$4,$5,$6,$7,coalesce($8, now()),$9)
     on conflict (org_id, message_id) where message_id is not null do nothing
     returning id`,
    [
      input.orgId,
      input.fromEmail.toLowerCase(),
      input.fromName ?? null,
      input.subject ?? null,
      (input.body ?? "").slice(0, SNIPPET_CHARS) || null,
      input.gmailThreadId ?? null,
      input.messageId ?? null,
      input.receivedAt ?? null,
      input.subcontractorId ?? null,
    ]
  );
  return row?.id ?? null;
}

/**
 * What is still waiting, oldest first.
 *
 * Oldest rather than newest, which is the opposite of a mailbox and the right
 * order for a queue: the message that has been sitting longest is the one most
 * likely to have already cost something.
 */
export async function needsMatching(orgId: string, limit = 100): Promise<UnmatchedMessage[]> {
  const rows = await query<Record<string, unknown>>(
    `select u.id, u.from_email, u.from_name, u.subject, u.snippet, u.received_at,
            u.gmail_thread_id, u.subcontractor_id, u.state, s.company_name
       from unmatched_inbound u
       left join subcontractors s on s.id = u.subcontractor_id
      where u.org_id = $1 and u.state = 'needs_matching'
      order by u.received_at
      limit $2`,
    [orgId, limit]
  );
  return rows.map((r) => ({
    id: String(r.id),
    fromEmail: String(r.from_email),
    fromName: (r.from_name as string) ?? null,
    subject: (r.subject as string) ?? null,
    snippet: (r.snippet as string) ?? null,
    receivedAt: r.received_at as Date,
    gmailThreadId: (r.gmail_thread_id as string) ?? null,
    subcontractorId: (r.subcontractor_id as string) ?? null,
    subcontractorName: (r.company_name as string) ?? null,
    state: "needs_matching",
  }));
}

/** How many are waiting. Used for the badge, so it is a count and not a list. */
export async function needsMatchingCount(orgId: string): Promise<number> {
  const row = await queryOne<{ n: number }>(
    `select count(*)::int as n from unmatched_inbound
      where org_id = $1 and state = 'needs_matching'`,
    [orgId]
  );
  return row?.n ?? 0;
}

/**
 * Place a message against an opportunity, recording it as a real reply.
 *
 * The communication row is what makes this a reply rather than a note: it is
 * the same table every matched reply lands in, so the conversation, the
 * coverage and the timeline all see it without knowing it arrived by hand.
 */
export async function matchMessage(
  id: string,
  orgId: string,
  opportunityId: string,
  actor: string,
  subcontractorId?: string | null
): Promise<{ communicationId: string } | null> {
  const msg = await queryOne<{
    id: string;
    from_email: string;
    subject: string | null;
    snippet: string | null;
    gmail_thread_id: string | null;
    received_at: Date;
    subcontractor_id: string | null;
  }>(
    `select id, from_email, subject, snippet, gmail_thread_id, received_at, subcontractor_id
       from unmatched_inbound
      where id = $1 and org_id = $2 and state = 'needs_matching'`,
    [id, orgId]
  );
  if (!msg) return null;

  // Both scoped: an opportunity id and a subcontractor id both arrive in a
  // request body, and neither is proof of anything on its own.
  const opp = await queryOne<{ id: string }>(
    `select id from opportunities where id = $1 and org_id = $2`,
    [opportunityId, orgId]
  );
  if (!opp) return null;

  const subId = subcontractorId ?? msg.subcontractor_id;
  if (subId) {
    const sub = await queryOne<{ id: string }>(
      `select id from subcontractors where id = $1 and org_id = $2`,
      [subId, orgId]
    );
    if (!sub) return null;
  }

  /*
   * The same insert the poller makes for a matched reply, column for column.
   *
   * Deliberately not a variant. A reply placed by hand is a real reply, and it
   * has to behave like one in the conversation, in the coverage graph and in
   * the timeline; a row that differs in any column is a row some query will
   * eventually treat differently for no reason anybody remembers.
   *
   * `delivery_state` is left at its default rather than set to something
   * inbound-flavoured: the deliverability numbers filter on outbound, so the
   * default is inert here, and the constraint does not have an inbound value
   * to offer anyway.
   */
  const comm = await queryOne<{ id: string }>(
    `insert into communications
       (org_id, opportunity_id, subcontractor_id, channel, direction, subject, body,
        gmail_thread_id, recipient_email, replied_at, created_at, meta)
     values ($1,$2,$3,'email','inbound',$4,$5,$6,$7, now(), $8, $9::jsonb)
     returning id`,
    [
      orgId,
      opportunityId,
      subId ?? null,
      msg.subject,
      msg.snippet,
      msg.gmail_thread_id,
      msg.from_email,
      msg.received_at,
      // Provenance. Somebody reading the record later is owed the fact that a
      // person decided this belonged here, rather than a header.
      JSON.stringify({ placed_by_hand: true, placed_by: actor, unmatched_id: id }),
    ]
  );

  await query(
    `update unmatched_inbound set state='matched', matched_communication_id=$3,
            matched_opportunity_id=$4, matched_by=$5, matched_at=now()
      where id=$1 and org_id=$2`,
    [id, orgId, comm?.id ?? null, opportunityId, actor]
  );
  return comm ? { communicationId: comm.id } : null;
}

/**
 * Say this message is not ours, and why.
 *
 * The reason is required, and the constraint underneath enforces it. "Not
 * ours" with no reason is indistinguishable from a message somebody could not
 * be bothered to read, and the whole value of this inbox is that the
 * difference is visible.
 */
export async function dismissMessage(
  id: string,
  orgId: string,
  reason: string,
  actor: string
): Promise<boolean> {
  const trimmed = reason.trim();
  if (!trimmed) return false;
  const rows = await query<{ id: string }>(
    `update unmatched_inbound set state='dismissed', dismissed_reason=$3,
            dismissed_by=$4, dismissed_at=now()
      where id=$1 and org_id=$2 and state='needs_matching'
      returning id`,
    [id, orgId, trimmed, actor]
  );
  return rows.length > 0;
}
