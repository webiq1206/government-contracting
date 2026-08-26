/**
 * What actually happened to one email, and whether an inbound message counts
 * as somebody answering.
 *
 * The log showed `sent` for everything it had not heard otherwise about, so a
 * message that was refused by the receiving server and one that arrived and
 * was read looked identical until you opened the row. The states below are the
 * ones the transport can actually tell us apart, and no others: inventing
 * `queued` for a system that writes the row after the send would be a status
 * that is never true.
 *
 * Pure.
 */

export type MessageState =
  | "received"
  | "replied"
  | "clicked"
  | "opened"
  | "delivered"
  | "sent"
  | "delayed"
  | "bounced"
  | "blocked"
  | "failed";

export const MESSAGE_STATE_LABEL: Record<MessageState, string> = {
  received: "From them",
  replied: "They replied",
  clicked: "Clicked a link",
  opened: "Opened",
  delivered: "Delivered",
  sent: "Sent, no confirmation yet",
  delayed: "Delayed, still trying",
  bounced: "Bounced, address is bad",
  blocked: "Blocked by their server",
  failed: "Never sent",
};

/** What each state means for the person reading it, and what it asks of them. */
export const MESSAGE_STATE_MEANING: Record<MessageState, string> = {
  received: "They wrote to you.",
  replied: "They answered this message.",
  clicked: "They opened it and followed a link in it.",
  opened: "It arrived and was opened.",
  delivered: "Their server accepted it. Whether anyone read it is unknown.",
  sent: "It left here. Their server has not confirmed either way yet.",
  delayed: "Their server is not accepting it yet. Delivery is still being retried.",
  bounced: "Their server refused it permanently. The address is wrong or gone.",
  blocked: "Their server refused it on policy grounds. The address may be fine.",
  failed: "The send itself failed, so it never left here. This one is ours to fix.",
};

/** Whether a state means the message did not arrive. */
export function isFailure(state: MessageState): boolean {
  return state === "bounced" || state === "blocked" || state === "failed";
}

export interface MessageRow {
  direction: string;
  delivery_state: string | null;
  delivery_detail: string | null;
  opened_at: string | Date | null;
  clicked_at: string | Date | null;
  replied_at: string | Date | null;
  subject: string | null;
  meta?: { kind?: string; auto?: boolean } | null;
}

/*
 * Phrases a receiving server uses when it is refusing on policy rather than
 * because the address is wrong. The distinction is worth drawing because the
 * fixes are opposite: a bounce means correct the address, a block means the
 * address is probably right and the sending domain needs attention.
 */
const BLOCK_PHRASES = [
  "blocked",
  "policy",
  "spam",
  "reject",
  "denied",
  "blacklist",
  "blocklist",
  "reputation",
  "not authorized",
  "unsolicited",
];

function looksBlocked(detail: string | null): boolean {
  if (!detail) return false;
  const d = detail.toLowerCase();
  return BLOCK_PHRASES.some((p) => d.includes(p));
}

/**
 * The one state a message is in.
 *
 * Failure beats engagement, always. A bounced message cannot have been opened,
 * so if both are somehow recorded the failure is what gets shown: the opposite
 * order would put "Opened" on a message that never arrived, which is the exact
 * kind of confident wrong answer that makes a person stop trusting the page.
 */
export function messageState(m: MessageRow): MessageState {
  if (m.direction === "inbound") return "received";

  const ds = m.delivery_state ?? "sent";
  if (ds === "failed") return "failed";
  if (ds === "bounced") return looksBlocked(m.delivery_detail) ? "blocked" : "bounced";
  if (ds === "deferred") return "delayed";

  if (m.replied_at) return "replied";
  if (m.clicked_at) return "clicked";
  if (m.opened_at) return "opened";
  if (ds === "delivered") return "delivered";
  return "sent";
}

/*
 * Subjects that mean a machine wrote back. Matched on the subject because that
 * is what every one of these puts it in, and because the alternative -- header
 * inspection -- needs data the poll does not keep.
 */
/*
 * Written once, as strings, because both sides need them. The thread list
 * decides "does this need a reply" in SQL over every conversation in the
 * account, and the thread pane decides it in TypeScript over the messages it
 * has loaded. Two copies of this list would drift, and the way you would find
 * out is a subcontractor being chased because an out-of-office counted on one
 * screen and not the other.
 *
 * Postgres advanced regular expressions accept this syntax as written, so the
 * SQL form is the same strings joined with alternation, matched case
 * insensitively with `~*`.
 */
export const AUTOMATIC_SUBJECT_SOURCES = [
  "^\\s*auto[\\s-]?repl(y|ies)",
  "^\\s*automatic reply",
  "^\\s*out of (the )?office",
  "^\\s*undeliverable",
  "^\\s*delivery status notification",
  "^\\s*mail delivery (failed|subsystem)",
  "^\\s*returned mail",
  "^\\s*failure notice",
  "vacation (auto)?repl(y|ies)",
];

/** The same list as one pattern, for `subject ~* $1` in Postgres. */
export const AUTOMATIC_SUBJECT_SQL = AUTOMATIC_SUBJECT_SOURCES.map((s) => `(${s})`).join("|");

const AUTOMATIC_SUBJECT_PATTERNS = AUTOMATIC_SUBJECT_SOURCES.map((s) => new RegExp(s, "i"));

/** True when an inbound message was written by a machine, not a person. */
export function isAutomatic(m: Pick<MessageRow, "subject" | "meta">): boolean {
  if (m.meta?.auto === true) return true;
  const subject = m.subject ?? "";
  return AUTOMATIC_SUBJECT_PATTERNS.some((re) => re.test(subject));
}

/**
 * Whether this message counts as somebody answering.
 *
 * Bounces, blocks and out-of-office notices arrive as inbound mail and were
 * being counted as replies, which inflated the response rate and, worse, took
 * a subcontractor off the chase list because the system believed they had
 * answered. An automatic acknowledgement is the absence of an answer, not a
 * quiet one.
 */
export function isGenuineReply(m: MessageRow): boolean {
  return m.direction === "inbound" && !isAutomatic(m);
}
