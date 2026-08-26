import { describe, it, expect } from "vitest";
import {
  deletionView,
  purgeDueAt,
  deletionBlockedReason,
  DELETION_GRACE_DAYS,
  RETENTION_EXPLANATION,
} from "@/lib/domain/account-deletion";

const NOW = new Date("2026-08-26T12:00:00Z");

describe("deletionView", () => {
  it("says nothing is scheduled for an ordinary account", () => {
    const v = deletionView(null, NOW);
    expect(v.state).toBe("none");
    expect(v.daysLeft).toBeNull();
    expect(v.urgent).toBe(false);
  });

  it("counts the days left", () => {
    const v = deletionView("2026-09-05T12:00:00Z", NOW);
    expect(v.state).toBe("scheduled");
    expect(v.daysLeft).toBe(10);
    expect(v.headline).toBe("Scheduled for deletion in 10 days");
  });

  it("rounds a partial day up, so an account with hours left is not shown as gone", () => {
    const v = deletionView("2026-08-27T07:00:00Z", NOW);
    expect(v.daysLeft).toBe(1);
    expect(v.headline).toContain("1 day");
    expect(v.urgent).toBe(true);
  });

  it("raises the last few days without raising the first few weeks", () => {
    expect(deletionView("2026-08-29T12:00:00Z", NOW).urgent).toBe(true);
    expect(deletionView("2026-09-20T12:00:00Z", NOW).urgent).toBe(false);
  });

  it("says a passed date is due rather than pretending it already ran", () => {
    // The sweep runs on a schedule, so between the date and the run the
    // account still exists, and claiming otherwise would be a lie an
    // administrator could act on.
    const v = deletionView("2026-08-20T12:00:00Z", NOW);
    expect(v.state).toBe("due");
    expect(v.headline).toContain("next sweep");
    expect(v.urgent).toBe(true);
  });

  it("ignores an unparseable date rather than scheduling on it", () => {
    expect(deletionView("whenever", NOW).state).toBe("none");
  });

  it("explains what is kept as well as what goes, everywhere", () => {
    expect(RETENTION_EXPLANATION).toContain("opportunities");
    expect(RETENTION_EXPLANATION).toContain("audit entry");
    expect(deletionView(null, NOW).retention).toBe(RETENTION_EXPLANATION);
    expect(deletionView("2026-09-05T12:00:00Z", NOW).retention).toBe(RETENTION_EXPLANATION);
  });
});

describe("purgeDueAt", () => {
  it("defaults to the grace period", () => {
    expect(purgeDueAt(NOW).toISOString()).toBe("2026-09-25T12:00:00.000Z");
    expect(DELETION_GRACE_DAYS).toBe(30);
  });

  it("accepts a shorter window when one is asked for", () => {
    expect(purgeDueAt(NOW, 7).toISOString()).toBe("2026-09-02T12:00:00.000Z");
  });
});

describe("deletionBlockedReason", () => {
  it("allows an ordinary account", () => {
    expect(deletionBlockedReason({ isOwnAccount: false, alreadyScheduled: false })).toBeNull();
  });

  it("refuses our own account, whatever else is true", () => {
    const r = deletionBlockedReason({ isOwnAccount: true, alreadyScheduled: true });
    expect(r).toContain("our own account");
  });

  it("refuses to restart the clock on an account already scheduled", () => {
    const r = deletionBlockedReason({ isOwnAccount: false, alreadyScheduled: true });
    expect(r).toContain("already scheduled");
  });
});
