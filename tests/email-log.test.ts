import { describe, it, expect } from "vitest";
import {
  EMAIL_LOG_STATUSES,
  emailLogStatusSql,
  parseEmailLogStatus,
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
