/**
 * What becomes of a scheduled send whose outcome was never recorded.
 *
 * A send is stamped `attempting` just before the mailbox is asked and settles
 * to sent, failed or held afterwards. A process that dies in between, or a
 * mailbox call that times out, leaves the row at `attempting` or `unknown`.
 * The mailbox's own Sent folder is the only authority on what left, so the
 * decision takes that lookup's answer and nothing else.
 */
export type SentLookup = "found" | "not_found" | "unavailable";

export type MailReconciliation = "record_sent" | "release_for_retry" | "leave";

export interface MailReconcileInput {
  deliveryState: string;
  /** meta.kind; a manual message is a person's own draft and is never resent by automation. */
  kind: string;
  lookup: SentLookup;
}

export function reconcileUncertainMail(input: MailReconcileInput): MailReconciliation {
  if (!["attempting", "unknown"].includes(input.deliveryState)) return "leave";
  if (input.lookup === "found") return "record_sent";
  if (input.lookup === "unavailable") return "leave";
  return input.kind === "manual" ? "leave" : "release_for_retry";
}

export const UNCERTAIN_MAIL_RELEASE_DETAIL =
  "The send was not found in the mailbox's Sent folder after its lease. It is held so the next outreach run can send it.";

export const UNCERTAIN_MAIL_CONFIRMED_DETAIL =
  "The send was found in the mailbox's Sent folder after its outcome went unrecorded, and is recorded as sent.";
