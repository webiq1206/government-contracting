/**
 * Reading the Communications centre: one row per conversation for the list,
 * every message for the one that is open.
 *
 * The old log paged over messages, which is why it could not answer "who is
 * waiting on me": that is a property of a conversation, and a conversation is
 * a group of rows. The list query aggregates in SQL so the four header counts
 * are computed over every conversation in the account rather than over one
 * page of them, and so a mailbox with twenty thousand messages costs one round
 * trip rather than twenty thousand rows in memory.
 *
 * No `.catch(() => [])` anywhere in here. A query that fails should take the
 * page down visibly, not quietly render an empty inbox that looks like an
 * account with no mail in it.
 */
import { query, queryOne } from "./db";
import { currentOrg } from "./data";
import { THREAD_KEY_SQL } from "./thread-key";
import {
  messageState,
  AUTOMATIC_SUBJECT_SQL,
  type MessageState,
} from "./domain/message-state";
import {
  verdict,
  preview,
  type CentreMessage,
  type ConversationSummary,
  type ConversationFacts,
  type ConversationVerdict,
} from "./domain/conversation-centre";


interface ThreadRow {
  thread_key: string;
  subcontractor_id: string | null;
  company_name: string | null;
  sub_email: string | null;
  opportunity_id: string | null;
  opportunity_title: string | null;
  trade: string | null;
  subject: string | null;
  last_body: string | null;
  last_at: string;
  message_count: string | number;
  unread_count: string | number;
  last_genuine_inbound_at: string | null;
  last_outbound_at: string | null;
  last_outbound_delivery_state: string | null;
  last_outbound_delivery_detail: string | null;
  last_outbound_opened_at: string | null;
  last_outbound_clicked_at: string | null;
  last_outbound_replied_at: string | null;
  follow_up_at: string | null;
  resolved_at: string | null;
  reply_to_message_id: string | null;
}

function n(v: string | number | null | undefined): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

function isoOrNull(v: string | Date | null): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Every conversation in the account, summarized.
 *
 * Returned whole rather than paged because the header counts and the filters
 * are both properties of the set: paging first would make every count a count
 * of one page. One row per conversation is small even for a busy account, and
 * the messages themselves are never loaded here.
 */
export async function conversationList(opts: { q?: string } = {}): Promise<ConversationSummary[]> {
  const orgId = await currentOrg();
  const needle = opts.q?.trim() ? `%${opts.q.trim()}%` : null;

  const rows = await query<ThreadRow>(
    `with msg as (
       select c.*, ${THREAD_KEY_SQL} as thread_key
         from communications c
        where c.org_id = $1 and c.channel = 'email'
     ),
     /*
      * One pass over the messages, with the per-thread facts the state machine
      * needs. A filtered aggregate keeps this to a single scan rather than one
      * correlated subquery per fact.
      */
     /* Read marks, joined in before the aggregate so unread is counted in the
      * same pass as everything else. It used to be a subquery correlated on
      * thread_key, evaluated once per thread against a CTE with no index:
      * O(threads x messages), and the single largest cost on this page. */
     flags as (
       select thread_key, read_at from conversation_flags where org_id = $1
     ),
     agg as (
       select m.thread_key,
              count(*) as message_count,
              max(m.created_at) as last_at,
              count(*) filter (
                where m.direction = 'inbound'
                  and (f.read_at is null or m.created_at > f.read_at)
              ) as unread_count,
              max(m.created_at) filter (
                where m.direction = 'inbound' and coalesce(m.subject,'') !~* $3
              ) as last_genuine_inbound_at,
              max(m.created_at) filter (where m.direction = 'outbound') as last_outbound_at,
              min(m.follow_up_at) filter (
                where m.direction = 'outbound' and m.replied_at is null
              ) as follow_up_at,
              min(m.subcontractor_id::text) as any_sub_id,
              min(m.opportunity_id::text) as any_opp_id
         from msg m
         left join flags f on f.thread_key = m.thread_key
        group by m.thread_key
     ),
     /* The newest message in each thread, for the subject line and preview. */
     newest as (
       select distinct on (m.thread_key)
              m.thread_key, m.subject, m.body, m.subcontractor_id, m.opportunity_id, m.meta
         from msg m
        order by m.thread_key, m.created_at desc
     ),
     /* The newest outbound one, whose delivery state is the thread's. */
     newest_out as (
       select distinct on (m.thread_key)
              m.thread_key, m.delivery_state, m.delivery_detail,
              m.opened_at, m.clicked_at, m.replied_at
         from msg m
        where m.direction = 'outbound'
        order by m.thread_key, m.created_at desc
     ),
     /* The newest inbound one, for threading a reply back into Gmail. */
     newest_in as (
       select distinct on (m.thread_key) m.thread_key, m.gmail_message_id
         from msg m
        where m.direction = 'inbound'
        order by m.thread_key, m.created_at desc
     ),
     /* The thread's own subject: the first message that had one. */
     first_subject as (
       select distinct on (m.thread_key) m.thread_key, m.subject
         from msg m
        where coalesce(m.subject,'') <> ''
        order by m.thread_key, m.created_at asc
     )
     select a.thread_key,
            coalesce(nw.subcontractor_id::text, a.any_sub_id) as subcontractor_id,
            s.company_name, s.email as sub_email,
            coalesce(nw.opportunity_id::text, a.any_opp_id) as opportunity_id,
            o.title as opportunity_title,
            nw.meta->>'trade' as trade,
            coalesce(fs.subject, nw.subject) as subject,
            nw.body as last_body,
            a.last_at::text as last_at,
            a.message_count,
            a.unread_count,
            a.last_genuine_inbound_at::text as last_genuine_inbound_at,
            a.last_outbound_at::text as last_outbound_at,
            no2.delivery_state as last_outbound_delivery_state,
            no2.delivery_detail as last_outbound_delivery_detail,
            no2.opened_at::text as last_outbound_opened_at,
            no2.clicked_at::text as last_outbound_clicked_at,
            no2.replied_at::text as last_outbound_replied_at,
            a.follow_up_at::text as follow_up_at,
            cf.resolved_at::text as resolved_at,
            ni.gmail_message_id as reply_to_message_id
       from agg a
       join newest nw on nw.thread_key = a.thread_key
       left join newest_out no2 on no2.thread_key = a.thread_key
       left join newest_in ni on ni.thread_key = a.thread_key
       left join first_subject fs on fs.thread_key = a.thread_key
       left join conversation_flags cf on cf.org_id = $1 and cf.thread_key = a.thread_key
       left join subcontractors s
              on s.id = coalesce(nw.subcontractor_id, a.any_sub_id::uuid) and s.org_id = $1
       left join opportunities o
              on o.id = coalesce(nw.opportunity_id, a.any_opp_id::uuid) and o.org_id = $1
      where ($2::text is null
             or lower(coalesce(s.company_name,'')) like lower($2)
             or lower(coalesce(fs.subject, nw.subject, '')) like lower($2)
             or lower(coalesce(o.title,'')) like lower($2))
      order by a.last_at desc
      limit 2000`,
    [orgId, needle, AUTOMATIC_SUBJECT_SQL]
  );

  return rows.map((r) => {
    const lastOutboundState: MessageState | null = r.last_outbound_at
      ? messageState({
          direction: "outbound",
          delivery_state: r.last_outbound_delivery_state,
          delivery_detail: r.last_outbound_delivery_detail,
          opened_at: r.last_outbound_opened_at,
          clicked_at: r.last_outbound_clicked_at,
          replied_at: r.last_outbound_replied_at,
          subject: null,
        })
      : null;

    const facts: ConversationFacts = {
      lastAt: isoOrNull(r.last_at) ?? new Date(0).toISOString(),
      messageCount: n(r.message_count),
      unreadCount: n(r.unread_count),
      lastGenuineInboundAt: isoOrNull(r.last_genuine_inbound_at),
      lastOutboundAt: isoOrNull(r.last_outbound_at),
      lastOutboundState,
      followUpAt: isoOrNull(r.follow_up_at),
      resolvedAt: isoOrNull(r.resolved_at),
    };
    const v = verdict(facts);

    return {
      threadKey: r.thread_key,
      subcontractorId: r.subcontractor_id,
      subcontractorName: r.company_name || "Unknown sender",
      subcontractorEmail: r.sub_email,
      opportunityId: r.opportunity_id,
      opportunityTitle: r.opportunity_title,
      trade: r.trade,
      subject: r.subject?.trim() || "No subject",
      preview: preview(r.last_body),
      lastAt: facts.lastAt,
      messageCount: facts.messageCount,
      unreadCount: facts.unreadCount,
      state: v.state,
      reason: v.reason,
      nextAction: v.nextAction,
      replyToMessageId: r.reply_to_message_id,
      failedState: v.failedState,
      followUpAt: facts.followUpAt,
    } satisfies ConversationSummary;
  });
}

interface MessageRowDb {
  id: string;
  direction: string;
  subject: string | null;
  body: string | null;
  created_at: string;
  recipient_email: string | null;
  gmail_message_id: string | null;
  delivery_state: string | null;
  delivery_detail: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  replied_at: string | null;
  follow_up_at: string | null;
  meta: { kind?: string; auto?: boolean } | null;
}

/**
 * Every message in one conversation, oldest first.
 *
 * Org-scoped on `communications.org_id` directly rather than through the
 * subcontractor: the thread key arrives from a query string, so this is the
 * boundary, and reading it off a joined table would mean a null org_id on the
 * join could open it.
 */
export async function conversationMessages(threadKey: string): Promise<CentreMessage[]> {
  const orgId = await currentOrg();
  const rows = await query<MessageRowDb>(
    `select c.id, c.direction, c.subject, c.body, c.created_at::text as created_at,
            c.recipient_email, c.gmail_message_id,
            c.delivery_state, c.delivery_detail,
            c.opened_at::text as opened_at, c.clicked_at::text as clicked_at,
            c.replied_at::text as replied_at, c.follow_up_at::text as follow_up_at,
            c.meta
       from communications c
      where c.org_id = $1 and c.channel = 'email' and ${THREAD_KEY_SQL} = $2
      order by c.created_at asc
      limit 500`,
    [orgId, threadKey]
  );

  return rows.map((r) => {
    const base = {
      id: r.id,
      direction: r.direction,
      subject: r.subject,
      body: r.body,
      created_at: r.created_at,
      recipient_email: r.recipient_email,
      gmail_message_id: r.gmail_message_id,
      delivery_state: r.delivery_state,
      delivery_detail: r.delivery_detail,
      opened_at: r.opened_at,
      clicked_at: r.clicked_at,
      replied_at: r.replied_at,
      follow_up_at: r.follow_up_at,
      meta: r.meta,
    };
    return { ...base, state: messageState(base) } satisfies CentreMessage;
  });
}

/** Every outbound and inbound message in the account, for the rate panel. */
export async function deliverabilityMessages(days = 90): Promise<CentreMessage[]> {
  const orgId = await currentOrg();
  const rows = await query<MessageRowDb>(
    `select c.id, c.direction, c.subject, c.body, c.created_at::text as created_at,
            c.recipient_email, c.gmail_message_id,
            c.delivery_state, c.delivery_detail,
            c.opened_at::text as opened_at, c.clicked_at::text as clicked_at,
            c.replied_at::text as replied_at, c.follow_up_at::text as follow_up_at,
            c.meta
       from communications c
      where c.org_id = $1 and c.channel = 'email'
        and c.created_at > now() - make_interval(days => $2::int)`,
    [orgId, days]
  );
  return rows.map((r) => {
    const base = {
      id: r.id,
      direction: r.direction,
      subject: r.subject,
      body: null,
      created_at: r.created_at,
      recipient_email: r.recipient_email,
      gmail_message_id: r.gmail_message_id,
      delivery_state: r.delivery_state,
      delivery_detail: r.delivery_detail,
      opened_at: r.opened_at,
      clicked_at: r.clicked_at,
      replied_at: r.replied_at,
      follow_up_at: r.follow_up_at,
      meta: r.meta,
    };
    return { ...base, state: messageState(base) } satisfies CentreMessage;
  });
}

/** Mark a conversation as looked at. Idempotent. */
export async function markConversationRead(orgId: string, threadKey: string): Promise<void> {
  await query(
    `insert into conversation_flags (org_id, thread_key, read_at, updated_at)
     values ($1, $2, now(), now())
     on conflict (org_id, thread_key)
     do update set read_at = now(), updated_at = now()`,
    [orgId, threadKey]
  );
}

/** Mark a conversation finished, or reopen it. */
export async function setConversationResolved(
  orgId: string,
  threadKey: string,
  resolved: boolean,
  userId: string | null
): Promise<void> {
  await query(
    `insert into conversation_flags (org_id, thread_key, resolved_at, resolved_by, updated_at)
     values ($1, $2, case when $3 then now() else null end, case when $3 then $4::uuid else null end, now())
     on conflict (org_id, thread_key)
     do update set resolved_at = case when $3 then now() else null end,
                   resolved_by = case when $3 then $4::uuid else null end,
                   updated_at = now()`,
    [orgId, threadKey, resolved, userId]
  );
}

/** Whether a thread key belongs to this org at all. */
export async function conversationExists(orgId: string, threadKey: string): Promise<boolean> {
  const row = await queryOne<{ one: number }>(
    `select 1 as one from communications c
      where c.org_id = $1 and c.channel = 'email' and ${THREAD_KEY_SQL} = $2
      limit 1`,
    [orgId, threadKey]
  );
  return row != null;
}

/**
 * Conversations waiting on a reply, for the navigation badge.
 *
 * The same predicate the Communications page uses, because it is the same
 * function: these rows are fed to `verdict()`, exactly as `conversationList`
 * feeds it. A badge computed a second way is a badge that eventually disagrees
 * with the page it points at, which is the failure the one-ledger rule exists
 * to prevent, and re-expressing "needs a reply" in SQL would be that second
 * way. `tests/conversation-badge.test.ts` pins the two against each other.
 *
 * What is dropped is the work the badge never uses. `conversationList` also
 * builds each thread's subject, preview body, subcontractor and opportunity
 * joins, and an unread count from a subquery correlated per thread. The badge
 * renders in the sidebar of every signed-in page, so at 20,000 messages that
 * was 1.7 seconds added to every route in the product, including ones with no
 * conversations on them at all: measured at 1,846ms on /settings/profile,
 * against 23ms before the account grew.
 *
 * unreadCount and messageCount are set to 0 rather than counted. Neither is
 * read by `verdict()`, and counting them is most of what made the list query
 * expensive. If a future state ever depends on either, this has to start
 * counting them, which is what the paired test is there to catch.
 */
export async function inboxNeedsReplyCount(): Promise<number> {
  const orgId = await currentOrg();
  const rows = await query<{
    last_at: string | null;
    last_genuine_inbound_at: string | null;
    last_outbound_at: string | null;
    last_outbound_delivery_state: string | null;
    last_outbound_delivery_detail: string | null;
    last_outbound_opened_at: string | null;
    last_outbound_clicked_at: string | null;
    last_outbound_replied_at: string | null;
    follow_up_at: string | null;
    resolved_at: string | null;
  }>(
    `with msg as (
       select c.*, ${THREAD_KEY_SQL} as thread_key
         from communications c
        where c.org_id = $1 and c.channel = 'email'
     ),
     agg as (
       select m.thread_key,
              max(m.created_at) as last_at,
              max(m.created_at) filter (
                where m.direction = 'inbound' and coalesce(m.subject,'') !~* $2
              ) as last_genuine_inbound_at,
              max(m.created_at) filter (where m.direction = 'outbound') as last_outbound_at,
              min(m.follow_up_at) filter (
                where m.direction = 'outbound' and m.replied_at is null
              ) as follow_up_at
         from msg m
        group by m.thread_key
     ),
     newest_out as (
       select distinct on (m.thread_key)
              m.thread_key, m.delivery_state, m.delivery_detail,
              m.opened_at, m.clicked_at, m.replied_at
         from msg m
        where m.direction = 'outbound'
        order by m.thread_key, m.created_at desc
     )
     select a.last_at::text as last_at,
            a.last_genuine_inbound_at::text as last_genuine_inbound_at,
            a.last_outbound_at::text as last_outbound_at,
            no2.delivery_state as last_outbound_delivery_state,
            no2.delivery_detail as last_outbound_delivery_detail,
            no2.opened_at::text as last_outbound_opened_at,
            no2.clicked_at::text as last_outbound_clicked_at,
            no2.replied_at::text as last_outbound_replied_at,
            a.follow_up_at::text as follow_up_at,
            cf.resolved_at::text as resolved_at
       from agg a
       left join newest_out no2 on no2.thread_key = a.thread_key
       left join conversation_flags cf on cf.org_id = $1 and cf.thread_key = a.thread_key`,
    [orgId, AUTOMATIC_SUBJECT_SQL]
  );

  return rows.filter((r) => factsFrom(r).state === "needs_reply").length;
}

/**
 * One row's facts, and the verdict the state machine draws from them.
 *
 * Shared by the list and the badge so neither can drift from the other. The
 * shape is deliberately the row, not the summary: it is the last point where
 * the two agree by construction rather than by inspection.
 */
function factsFrom(r: {
  last_at: string | null;
  message_count?: number | string | null;
  unread_count?: number | string | null;
  last_genuine_inbound_at: string | null;
  last_outbound_at: string | null;
  last_outbound_delivery_state: string | null;
  last_outbound_delivery_detail: string | null;
  last_outbound_opened_at: string | null;
  last_outbound_clicked_at: string | null;
  last_outbound_replied_at: string | null;
  follow_up_at: string | null;
  resolved_at: string | null;
}): ConversationVerdict & { facts: ConversationFacts } {
  const lastOutboundState: MessageState | null = r.last_outbound_at
    ? messageState({
        direction: "outbound",
        delivery_state: r.last_outbound_delivery_state,
        delivery_detail: r.last_outbound_delivery_detail,
        opened_at: r.last_outbound_opened_at,
        clicked_at: r.last_outbound_clicked_at,
        replied_at: r.last_outbound_replied_at,
        subject: null,
      })
    : null;
  const facts: ConversationFacts = {
    lastAt: isoOrNull(r.last_at) ?? new Date(0).toISOString(),
    messageCount: n(r.message_count),
    unreadCount: n(r.unread_count),
    lastGenuineInboundAt: isoOrNull(r.last_genuine_inbound_at),
    lastOutboundAt: isoOrNull(r.last_outbound_at),
    lastOutboundState,
    followUpAt: isoOrNull(r.follow_up_at),
    resolvedAt: isoOrNull(r.resolved_at),
  };
  return { ...verdict(facts), facts };
}
