/**
 * Email log status filters. Inclusive: "sent" is all outbound, "opened" is
 * any outbound with an open, "responded" is inbound replies plus outbound
 * mail that has a reply recorded.
 */

export const EMAIL_LOG_STATUSES = [
  "all",
  "sent",
  "opened",
  "clicked",
  "responded",
  /*
   * The failures. Their absence was the gap that mattered: after the bounce
   * work there is a delivery_state on every row saying a message was refused,
   * blocked or never left the building, and no way at all to ask the log to
   * show them. "Which of these did not arrive" is the question this page
   * exists to answer, and it was the one question it could not.
   */
  "bounced",
  "deferred",
  "failed",
  "inbound",
] as const;

export type EmailLogStatusFilter = (typeof EMAIL_LOG_STATUSES)[number];

export const EMAIL_LOG_STATUS_LABELS: Record<EmailLogStatusFilter, string> = {
  all: "All",
  sent: "Sent",
  opened: "Opened",
  clicked: "Clicked",
  responded: "Responded",
  bounced: "Bounced",
  deferred: "Delayed",
  failed: "Never sent",
  inbound: "From them",
};

export function parseEmailLogStatus(raw?: string | null): EmailLogStatusFilter {
  if (raw && (EMAIL_LOG_STATUSES as readonly string[]).includes(raw)) {
    return raw as EmailLogStatusFilter;
  }
  return "all";
}

/**
 * SQL predicate (communications alias `c`) for a status filter.
 * `responded_expr` should be a boolean SQL expression already in scope
 * (inbound row, replied_at, or a matching inbound join).
 */
export function emailLogStatusSql(
  status: EmailLogStatusFilter,
  respondedExpr = "(c.direction = 'inbound' or c.replied_at is not null)"
): string {
  switch (status) {
    case "sent":
      return "c.direction = 'outbound'";
    case "opened":
      return "c.direction = 'outbound' and c.opened_at is not null";
    case "clicked":
      return "c.direction = 'outbound' and c.clicked_at is not null";
    case "responded":
      return respondedExpr;
    // A permanent refusal by the receiving server: the address is bad.
    case "bounced":
      return "c.delivery_state = 'bounced'";
    // Temporary: a full mailbox, greylisting. The address may be fine.
    case "deferred":
      return "c.delivery_state = 'deferred'";
    // The send itself failed, so nothing ever left the building. Distinct from
    // a bounce, and the fix is ours rather than theirs.
    case "failed":
      return "c.delivery_state = 'failed'";
    case "inbound":
      return "c.direction = 'inbound'";
    default:
      return "true";
  }
}
