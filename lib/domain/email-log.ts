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
] as const;

export type EmailLogStatusFilter = (typeof EMAIL_LOG_STATUSES)[number];

export const EMAIL_LOG_STATUS_LABELS: Record<EmailLogStatusFilter, string> = {
  all: "All",
  sent: "Sent",
  opened: "Opened",
  clicked: "Clicked",
  responded: "Responded",
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
    default:
      return "true";
  }
}
