/**
 * The shape of an email conversation, and the rules about it that both sides
 * of the wire need to agree on.
 *
 * Split out from `conversation.ts` deliberately: that module talks to the
 * database, and the composer that renders these threads runs in the browser.
 * Importing the query module from a client component drags the Postgres client
 * into the bundle. Everything here is plain data and pure functions, so both
 * the server page and the client composer can share one definition of what a
 * conversation is instead of keeping two copies in step by hand.
 */

export interface ConversationMessage {
  id: string;
  direction: "inbound" | "outbound";
  subject: string | null;
  body: string | null;
  created_at: string;
  recipient_email: string | null;
  /** "clarification" for the automatic follow-up, so the UI can label it. */
  kind: string | null;
  gmail_message_id: string | null;
}

export interface Conversation {
  /** Gmail thread id, or a synthetic key when the messages predate threading. */
  key: string;
  threadId: string | null;
  opportunityId: string | null;
  opportunityTitle: string | null;
  trade: string | null;
  subject: string | null;
  lastAt: string;
  /** Newest inbound message id, used as In-Reply-To when replying. */
  replyToMessageId: string | null;
  awaitingUs: boolean;
  messages: ConversationMessage[];
}

/**
 * The message a reply would answer: the newest one, and only when it is
 * theirs. Searching backwards for "the last inbound message" looks equivalent
 * and is not: a thread we already answered would keep offering the sub's older
 * email as something to reply to, which means a second answer to a question
 * that was answered days ago, and a stale draft reappearing as if it were new.
 * A thread whose last word is ours has nothing to reply to.
 */
export function replyTarget(
  conversation: Pick<Conversation, "messages">
): ConversationMessage | null {
  const last = conversation.messages[conversation.messages.length - 1];
  return last && last.direction === "inbound" ? last : null;
}
