import { describe, it, expect } from "vitest";
import {
  EMAIL_LOG_STATUSES,
  emailLogStatusSql,
  parseEmailLogStatus,
  EMAIL_LOG_STATUS_LABELS,
} from "../lib/domain/email-log";

describe("parseEmailLogStatus", () => {
  it("accepts known filters", () => {
    for (const s of EMAIL_LOG_STATUSES) {
      expect(parseEmailLogStatus(s)).toBe(s);
    }
  });

  it("falls back to all for missing or unknown values", () => {
    expect(parseEmailLogStatus(undefined)).toBe("all");
    expect(parseEmailLogStatus(null)).toBe("all");
    expect(parseEmailLogStatus("bogus")).toBe("all");
  });
});

describe("emailLogStatusSql", () => {
  it("scopes sent to outbound", () => {
    expect(emailLogStatusSql("sent")).toContain("outbound");
    expect(emailLogStatusSql("sent")).not.toContain("opened_at");
  });

  it("scopes opened and clicked to tracking timestamps", () => {
    expect(emailLogStatusSql("opened")).toContain("opened_at is not null");
    expect(emailLogStatusSql("clicked")).toContain("clicked_at is not null");
  });

  it("scopes responded to inbound or replied_at", () => {
    const sql = emailLogStatusSql("responded");
    expect(sql).toContain("inbound");
    expect(sql).toContain("replied_at");
  });

  it("all is a no-op predicate", () => {
    expect(emailLogStatusSql("all")).toBe("true");
  });
});

/**
 * The failure filters.
 *
 * After the bounce work every row carries a delivery_state saying whether the
 * message was refused, delayed or never left the building -- and the log had
 * no way to ask for them. "Which of these did not arrive" is the question this
 * page exists to answer, and it was the one question it could not.
 */
describe("delivery-failure statuses", () => {
  it("offers a filter for each failure the system can record", () => {
    for (const s of ["bounced", "deferred", "failed", "inbound"]) {
      expect(EMAIL_LOG_STATUSES).toContain(s);
      expect(parseEmailLogStatus(s)).toBe(s);
    }
  });

  it("tells a permanent refusal apart from a temporary one and from a failed send", () => {
    // Three different problems with three different owners: their address is
    // dead, their mailbox was briefly full, or our send never happened.
    expect(emailLogStatusSql("bounced")).toBe("c.delivery_state = 'bounced'");
    expect(emailLogStatusSql("deferred")).toBe("c.delivery_state = 'deferred'");
    expect(emailLogStatusSql("failed")).toBe("c.delivery_state = 'failed'");
  });

  it("can show only what they sent us", () => {
    expect(emailLogStatusSql("inbound")).toBe("c.direction = 'inbound'");
  });

  it("still falls back to everything for an unknown status", () => {
    // A stale link should widen the list, never empty it.
    expect(parseEmailLogStatus("smells-funny")).toBe("all");
    expect(emailLogStatusSql("all")).toBe("true");
  });

  it("gives every status a human label", () => {
    for (const s of EMAIL_LOG_STATUSES) {
      expect(EMAIL_LOG_STATUS_LABELS[s]).toBeTruthy();
    }
    // Named for what the operator is looking for, not for the column value.
    expect(EMAIL_LOG_STATUS_LABELS.failed).toBe("Never sent");
    expect(EMAIL_LOG_STATUS_LABELS.deferred).toBe("Delayed");
  });
});
