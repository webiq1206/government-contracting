/**
 * Email conversations with a subcontractor, assembled from what we already
 * store rather than fetched live from Gmail.
 *
 * Both directions land in `communications` (outreach writes the outbound row,
 * the reply poll writes the inbound one), so the thread can be rendered
 * instantly and still reads correctly when Gmail is briefly unreachable.
 *
 * Grouping is by Gmail thread id where we have one. Messages that predate
 * threading, or that were logged without a thread, are grouped by
 * solicitation instead so nothing is dropped from the history.
 */
import { query } from "../db";
import type { Conversation, ConversationMessage } from "./conversation-thread";

// The shape and the "what can be replied to" rule live in a database-free
// module so the browser composer can share them. Re-exported here so callers
// that already read from this module do not have to care.
export { replyTarget } from "./conversation-thread";
export type { Conversation, ConversationMessage };

interface Row {
  id: string;
  direction: string;
  subject: string | null;
  body: string | null;
  created_at: string;
  recipient_email: string | null;
  gmail_thread_id: string | null;
  gmail_message_id: string | null;
  opportunity_id: string | null;
  opportunity_title: string | null;
  meta: { kind?: string; trade?: string } | null;
}

/**
 * Every email exchange with one subcontractor, newest conversation first and
 * oldest message first inside each conversation (how a person reads a thread).
 */
export async function subConversations(
  subcontractorId: string
): Promise<Conversation[]> {
  const rows = await query<Row>(
    `select c.id, c.direction, c.subject, c.body, c.created_at,
            c.recipient_email, c.gmail_thread_id, c.gmail_message_id,
            c.opportunity_id, o.title as opportunity_title, c.meta
       from communications c
       left join opportunities o on o.id = c.opportunity_id
      where c.subcontractor_id = $1 and c.channel = 'email'
      order by c.created_at asc
      limit 500`,
    [subcontractorId]
  ).catch(() => []);

  const byKey = new Map<string, Conversation>();
  for (const r of rows) {
    // Fall back to the solicitation so pre-threading history still groups into
    // something a person recognises instead of one conversation per message.
    const key = r.gmail_thread_id ?? `opp:${r.opportunity_id ?? "none"}`;
    let conv = byKey.get(key);
    if (!conv) {
      conv = {
        key,
        threadId: r.gmail_thread_id,
        opportunityId: r.opportunity_id,
        opportunityTitle: r.opportunity_title,
        trade: r.meta?.trade ?? null,
        subject: r.subject,
        lastAt: r.created_at,
        replyToMessageId: null,
        awaitingUs: false,
        messages: [],
      };
      byKey.set(key, conv);
    }
    const direction = r.direction === "inbound" ? "inbound" : "outbound";
    conv.messages.push({
      id: r.id,
      direction,
      subject: r.subject,
      body: r.body,
      created_at: r.created_at,
      recipient_email: r.recipient_email,
      kind: r.meta?.kind ?? null,
      gmail_message_id: r.gmail_message_id,
    });
    conv.lastAt = r.created_at;
    // The subject of the first message is the thread's subject; later "Re:"
    // rows would otherwise overwrite it with a less useful string.
    if (!conv.subject) conv.subject = r.subject;
    if (!conv.trade && r.meta?.trade) conv.trade = r.meta.trade;
    if (!conv.opportunityTitle && r.opportunity_title) {
      conv.opportunityTitle = r.opportunity_title;
    }
    if (direction === "inbound" && r.gmail_message_id) {
      conv.replyToMessageId = r.gmail_message_id;
    }
    // Whether the ball is in our court: true when the newest message is theirs.
    conv.awaitingUs = direction === "inbound";
  }

  return [...byKey.values()].sort(
    (a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime()
  );
}
