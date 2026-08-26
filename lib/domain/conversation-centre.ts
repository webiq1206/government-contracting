/**
 * A conversation as the Communications centre needs it: its state, what it is
 * waiting on, and the one thing to do about it next.
 *
 * The page this replaces was a log -- one row per message, newest first --
 * which answers "what happened" and cannot answer "who is waiting on me".
 * Those are different questions, and only the second one is work. Everything
 * here is derived from messages already stored, so a conversation's state
 * cannot drift out of step with the mail it is made of.
 *
 * Pure.
 */

import {
  isFailure,
  isGenuineReply,
  messageState,
  type MessageRow,
  type MessageState,
} from "./message-state";

export type ConversationState =
  | "needs_reply"
  | "delivery_failed"
  | "overdue"
  | "awaiting_them"
  | "resolved"
  | "closed";

export const CONVERSATION_STATE_LABEL: Record<ConversationState, string> = {
  needs_reply: "Needs your reply",
  delivery_failed: "Did not arrive",
  overdue: "Follow-up overdue",
  awaiting_them: "Waiting on them",
  resolved: "Resolved",
  closed: "Nothing outstanding",
};

/** The filters the centre offers, in the order the header lists them. */
export const CONVERSATION_FILTERS = [
  "all",
  "unread",
  "needs_reply",
  "delivery_failed",
  "overdue",
  "awaiting_them",
  "resolved",
] as const;

export type ConversationFilter = (typeof CONVERSATION_FILTERS)[number];

export const CONVERSATION_FILTER_LABEL: Record<ConversationFilter, string> = {
  all: "Everything",
  unread: "Unread",
  needs_reply: "Needs your reply",
  delivery_failed: "Did not arrive",
  overdue: "Follow-up overdue",
  awaiting_them: "Waiting on them",
  resolved: "Resolved",
};

export function parseConversationFilter(
  raw: string | string[] | undefined
): ConversationFilter {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (CONVERSATION_FILTERS as readonly string[]).includes(v ?? "")
    ? (v as ConversationFilter)
    : "all";
}

/** One message, as both the list and the thread pane need it. */
export interface CentreMessage extends MessageRow {
  id: string;
  created_at: string;
  body: string | null;
  recipient_email: string | null;
  gmail_message_id: string | null;
  /** When the automatic chase is due. Null once they answer, or if never set. */
  follow_up_at: string | Date | null;
  state: MessageState;
}

export interface ConversationSummary {
  threadKey: string;
  subcontractorId: string | null;
  subcontractorName: string;
  subcontractorEmail: string | null;
  opportunityId: string | null;
  opportunityTitle: string | null;
  trade: string | null;
  subject: string;
  /** Newest message first line, trimmed for the list. */
  preview: string;
  lastAt: string;
  messageCount: number;
  unreadCount: number;
  state: ConversationState;
  /** Why it is in that state, in one line. */
  reason: string;
  /** The single next action, named as a verb. */
  nextAction: string;
  /** Newest inbound Gmail message id, for threading a reply. */
  replyToMessageId: string | null;
  /** True when the newest outbound message did not arrive. */
  failedState: MessageState | null;
  /** Follow-up date still outstanding, ISO, or null. */
  followUpAt: string | null;
}

export interface ConversationCounts {
  unread: number;
  needsReply: number;
  deliveryFailed: number;
  overdue: number;
}

/** First non-empty line of a body, collapsed and cut for a list row. */
export function preview(body: string | null, limit = 120): string {
  if (!body) return "";
  const text = body
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function iso(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export interface ThreadInput {
  threadKey: string;
  subcontractorId: string | null;
  subcontractorName: string | null;
  subcontractorEmail: string | null;
  opportunityId: string | null;
  opportunityTitle: string | null;
  trade: string | null;
  resolvedAt: string | Date | null;
  readAt: string | Date | null;
  /** Oldest first, the way a person reads a thread. */
  messages: CentreMessage[];
}

/**
 * Everything the state machine needs, and nothing it does not.
 *
 * The list pane computes these in SQL across every conversation in the
 * account; the thread pane computes them in TypeScript from the messages it
 * already has. Both then call the same function, so a conversation cannot read
 * "Needs your reply" in one place and "Waiting on them" in the other.
 */
export interface ConversationFacts {
  lastAt: string;
  messageCount: number;
  unreadCount: number;
  /** Newest inbound message that a person actually wrote. */
  lastGenuineInboundAt: string | null;
  lastOutboundAt: string | null;
  lastOutboundState: MessageState | null;
  /** Earliest outstanding follow-up on an unanswered outbound message. */
  followUpAt: string | null;
  resolvedAt: string | null;
}

export interface ConversationVerdict {
  state: ConversationState;
  reason: string;
  nextAction: string;
  failedState: MessageState | null;
}

/**
 * Decide the state of one conversation.
 *
 * Ordered by what stops work rather than by what happened most recently. A
 * message that never arrived outranks a reply that is waiting, because a reply
 * that is waiting is a conversation and a message that never arrived is a
 * subcontractor who does not know they were asked.
 */
export function verdict(f: ConversationFacts, now = new Date()): ConversationVerdict {
  const failedState =
    f.lastOutboundState && isFailure(f.lastOutboundState) ? f.lastOutboundState : null;

  // Whose turn it is: only true when nothing of ours came after their message.
  const awaitingUs =
    f.lastGenuineInboundAt != null &&
    (f.lastOutboundAt == null ||
      new Date(f.lastGenuineInboundAt).getTime() > new Date(f.lastOutboundAt).getTime());

  const overdue =
    f.followUpAt != null &&
    new Date(f.followUpAt).getTime() < now.getTime() &&
    f.lastGenuineInboundAt == null;

  /*
   * An explicit decision outranks a derived one, but only for what it was a
   * decision about. Somebody who marks a bounced conversation resolved has
   * decided not to chase that address, and the board should believe them --
   * a "Mark resolved" button that visibly does nothing is worse than no
   * button. If anything has happened in the thread since, the decision is
   * stale and the derived state takes back over: resolved means resolved as
   * of then, not resolved forever.
   */
  const resolvedIsCurrent =
    f.resolvedAt != null && new Date(f.resolvedAt).getTime() >= new Date(f.lastAt).getTime();

  if (resolvedIsCurrent) {
    return {
      state: "resolved",
      failedState,
      reason: failedState
        ? "The last message did not arrive, and somebody marked this finished anyway."
        : "Somebody marked this finished.",
      nextAction: "Reopen it if something changed.",
    };
  }

  if (failedState) {
    return {
      state: "delivery_failed",
      failedState,
      reason:
        failedState === "failed"
          ? "The last message never left here."
          : failedState === "blocked"
            ? "Their server refused the last message on policy grounds."
            : "Their server refused the last message. The address is wrong or gone.",
      nextAction:
        failedState === "bounced"
          ? "Correct the email address, then resend."
          : failedState === "blocked"
            ? "Call them instead, and check the sending domain."
            : "Resend it.",
    };
  }
  if (awaitingUs) {
    return {
      state: "needs_reply",
      failedState: null,
      reason: "They wrote and nothing has gone back.",
      nextAction: "Reply.",
    };
  }
  if (overdue) {
    return {
      state: "overdue",
      failedState: null,
      reason: "The follow-up date passed with no answer.",
      nextAction: "Chase it, or call them instead.",
    };
  }
  if (f.lastOutboundAt && !f.lastGenuineInboundAt) {
    return {
      state: "awaiting_them",
      failedState: null,
      reason: f.followUpAt ? "Sent. A follow-up is scheduled." : "Sent. Nothing back yet.",
      nextAction: "Nothing until they answer.",
    };
  }
  return {
    state: "closed",
    failedState: null,
    reason: "The last word is yours and nothing is outstanding.",
    nextAction: "Nothing right now.",
  };
}

/** The facts a thread's own messages imply. */
export function factsFrom(t: ThreadInput): ConversationFacts {
  const messages = t.messages;
  const last = messages[messages.length - 1];
  const readAt = iso(t.readAt);

  const lastOutbound = [...messages].reverse().find((m) => m.direction === "outbound");
  const lastGenuineInbound = [...messages].reverse().find((m) => isGenuineReply(m));

  const followUps = messages
    .filter((m) => m.direction === "outbound" && !m.replied_at)
    .map((m) => iso(m.follow_up_at))
    .filter((v): v is string => v != null)
    .sort();

  return {
    lastAt: iso(last?.created_at) ?? new Date(0).toISOString(),
    messageCount: messages.length,
    unreadCount: messages.filter(
      (m) => m.direction === "inbound" && (!readAt || (iso(m.created_at) ?? "") > readAt)
    ).length,
    lastGenuineInboundAt: lastGenuineInbound ? iso(lastGenuineInbound.created_at) : null,
    lastOutboundAt: lastOutbound ? iso(lastOutbound.created_at) : null,
    lastOutboundState: lastOutbound?.state ?? null,
    followUpAt: followUps[0] ?? null,
    resolvedAt: iso(t.resolvedAt),
  };
}

/** One conversation, summarized from the messages it is made of. */
export function summarize(t: ThreadInput, now = new Date()): ConversationSummary {
  const facts = factsFrom(t);
  const v = verdict(facts, now);
  const last = t.messages[t.messages.length - 1];
  const subject =
    t.messages.find((m) => m.subject && m.subject.trim())?.subject?.trim() || "No subject";

  return {
    threadKey: t.threadKey,
    subcontractorId: t.subcontractorId,
    subcontractorName: t.subcontractorName || "Unknown sender",
    subcontractorEmail: t.subcontractorEmail,
    opportunityId: t.opportunityId,
    opportunityTitle: t.opportunityTitle,
    trade: t.trade,
    subject,
    preview: preview(last?.body ?? null),
    lastAt: facts.lastAt,
    messageCount: facts.messageCount,
    unreadCount: facts.unreadCount,
    state: v.state,
    reason: v.reason,
    nextAction: v.nextAction,
    replyToMessageId:
      [...t.messages].reverse().find((m) => m.direction === "inbound")?.gmail_message_id ?? null,
    failedState: v.failedState,
    followUpAt: facts.followUpAt,
  };
}

/**
 * The four counts in the header.
 *
 * Every one of them is a real measurement over every conversation in the
 * account, never over the current filter: a header count that moves when a
 * filter is applied describes the filter rather than the inbox.
 */
export function conversationCounts(list: ConversationSummary[]): ConversationCounts {
  let unread = 0;
  let needsReply = 0;
  let deliveryFailed = 0;
  let overdue = 0;
  for (const c of list) {
    if (c.unreadCount > 0) unread += 1;
    if (c.state === "needs_reply") needsReply += 1;
    if (c.state === "delivery_failed") deliveryFailed += 1;
    if (c.state === "overdue") overdue += 1;
  }
  return { unread, needsReply, deliveryFailed, overdue };
}

/** Whether a conversation belongs in the current filter. */
export function matchesFilter(c: ConversationSummary, f: ConversationFilter): boolean {
  switch (f) {
    case "unread":
      return c.unreadCount > 0;
    case "needs_reply":
      return c.state === "needs_reply";
    case "delivery_failed":
      return c.state === "delivery_failed";
    case "overdue":
      return c.state === "overdue";
    case "awaiting_them":
      return c.state === "awaiting_them";
    case "resolved":
      return c.state === "resolved";
    default:
      return true;
  }
}

export interface Deliverability {
  /** Outbound messages the numbers below are computed over. */
  sent: number;
  /** Null when nothing has been sent: a rate over zero messages is not 0%. */
  deliveryRate: number | null;
  responseRate: number | null;
  bounceRate: number | null;
  blocked: number;
  failed: number;
}

/**
 * Delivery, response and bounce rates.
 *
 * Rates are null rather than 0 when nothing has been sent. A brand new account
 * showing "0% delivered" is being told its mail is failing, which is both
 * false and the most alarming possible reading of no data.
 *
 * Automatic replies are excluded from the response rate by construction: the
 * count comes from genuine replies only, so an inbox full of out-of-office
 * notices cannot make outreach look like it is working.
 */
export function deliverability(messages: CentreMessage[]): Deliverability {
  const outbound = messages.filter((m) => m.direction === "outbound");
  const sent = outbound.length;
  if (sent === 0) {
    return {
      sent: 0,
      deliveryRate: null,
      responseRate: null,
      bounceRate: null,
      blocked: 0,
      failed: 0,
    };
  }

  const arrived = outbound.filter((m) => !isFailure(m.state)).length;
  const bounced = outbound.filter((m) => m.state === "bounced").length;
  const blocked = outbound.filter((m) => m.state === "blocked").length;
  const failed = outbound.filter((m) => m.state === "failed").length;
  const replied = messages.filter((m) => isGenuineReply(m)).length;

  return {
    sent,
    deliveryRate: arrived / sent,
    responseRate: Math.min(1, replied / sent),
    bounceRate: bounced / sent,
    blocked,
    failed,
  };
}

/** A rate as a percentage, or the reason there is no rate. */
export function formatRate(rate: number | null): string {
  if (rate == null) return "Nothing sent yet";
  return `${Math.round(rate * 100)}%`;
}

export { messageState, isGenuineReply, isFailure };
export type { MessageState };
