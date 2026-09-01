import { describe, it, expect } from "vitest";
import {
  followUpMaySend,
  mayExpireOpportunity,
  recordIsClosed,
  closedRecordReason,
} from "../lib/domain/closed-work";
import {
  inboxStatusItem,
  samStatusItem,
  automationStatusItem,
  SYSTEM_STATUS_LABEL,
} from "../lib/domain/system-status";

const NOW = new Date("2026-09-01T18:00:00.000Z");

describe("recordIsClosed", () => {
  it("keeps an open, in-progress opportunity active", () => {
    expect(recordIsClosed({ status: "open", stage: "outreach" })).toBe(false);
  });

  it("closes archived, passed, won, lost, and submitted bids", () => {
    expect(recordIsClosed({ status: "archived", stage: "outreach" })).toBe(true);
    expect(recordIsClosed({ status: "open", stage: "dismissed" })).toBe(true);
    expect(recordIsClosed({ status: "open", stage: "won" })).toBe(true);
    expect(recordIsClosed({ status: "open", stage: "lost" })).toBe(true);
    expect(recordIsClosed({ status: "open", stage: "outreach", bidSubmitted: true })).toBe(true);
    expect(
      recordIsClosed({ status: "open", stage: "bid_building", submissionState: "sending" })
    ).toBe(true);
  });
});

describe("followUpMaySend", () => {
  it("allows a follow-up only on open, active, unsubmitted work", () => {
    expect(
      followUpMaySend({ status: "open", stage: "outreach", pursuitState: "active" })
    ).toBe(true);
  });

  it("stops follow-ups after pass, abort, expire, or submit", () => {
    expect(
      followUpMaySend({ status: "archived", stage: "outreach", pursuitState: "active" })
    ).toBe(false);
    expect(
      followUpMaySend({ status: "open", stage: "outreach", pursuitState: "aborted" })
    ).toBe(false);
    expect(
      followUpMaySend({ status: "open", stage: "outreach", pursuitState: "paused" })
    ).toBe(false);
    expect(
      followUpMaySend({ status: "open", stage: "submitted", pursuitState: "active" })
    ).toBe(false);
    expect(
      followUpMaySend({ status: "open", stage: "dismissed", pursuitState: "active" })
    ).toBe(false);
  });
});

describe("mayExpireOpportunity", () => {
  it("expires an open unsubmitted opportunity whose deadline has passed", () => {
    expect(
      mayExpireOpportunity({
        status: "open",
        stage: "outreach",
        deadline: "2026-08-31T23:59:00.000Z",
        now: NOW,
      })
    ).toBe(true);
  });

  it("never expires a submitted or in-flight bid", () => {
    expect(
      mayExpireOpportunity({
        status: "open",
        stage: "submitted",
        deadline: "2026-08-31T23:59:00.000Z",
        now: NOW,
      })
    ).toBe(false);
    expect(
      mayExpireOpportunity({
        status: "open",
        stage: "bid_building",
        deadline: "2026-08-31T23:59:00.000Z",
        now: NOW,
        bidSubmitted: true,
      })
    ).toBe(false);
    expect(
      mayExpireOpportunity({
        status: "open",
        stage: "bid_building",
        deadline: "2026-08-31T23:59:00.000Z",
        now: NOW,
        submissionState: "sending",
      })
    ).toBe(false);
  });

  it("does not expire a future deadline, a missing deadline, or a keep-open override", () => {
    expect(
      mayExpireOpportunity({
        status: "open",
        stage: "outreach",
        deadline: "2026-09-15T23:59:00.000Z",
        now: NOW,
      })
    ).toBe(false);
    expect(
      mayExpireOpportunity({
        status: "open",
        stage: "outreach",
        deadline: null,
        now: NOW,
      })
    ).toBe(false);
    expect(
      mayExpireOpportunity({
        status: "open",
        stage: "outreach",
        deadline: "2026-08-31T23:59:00.000Z",
        now: NOW,
        keepOpen: true,
      })
    ).toBe(false);
  });
});

describe("closedRecordReason", () => {
  it("explains the stop in plain language", () => {
    expect(closedRecordReason({ status: "archived" })).toMatch(/closed/i);
    expect(closedRecordReason({ status: "open", stage: "dismissed" })).toMatch(/passed/i);
    expect(closedRecordReason({ status: "open", bidSubmitted: true })).toMatch(/submitted/i);
  });
});

describe("system status labels", () => {
  it("never uses color as the only signal", () => {
    expect(SYSTEM_STATUS_LABEL.working).toBe("Working");
    expect(SYSTEM_STATUS_LABEL.failed).toBe("Failed");
    expect(SYSTEM_STATUS_LABEL.disconnected).toBe("Disconnected");
    expect(SYSTEM_STATUS_LABEL.action_required).toBe("Action required");
  });

  it("says a missing inbox is disconnected, not healthy", () => {
    const item = inboxStatusItem({
      connected: false,
      email: null,
      status: "none",
      lastError: null,
    });
    expect(item.kind).toBe("disconnected");
    expect(item.actionLabel).toBe("Connect email");
  });

  it("asks the user to reconnect a revoked mailbox", () => {
    const item = inboxStatusItem({
      connected: false,
      email: "ops@example.com",
      status: "revoked",
      lastError: null,
    });
    expect(item.kind).toBe("action_required");
    expect(item.actionLabel).toBe("Fix email connection");
  });

  it("does not treat a missing SAM key as working", () => {
    expect(samStatusItem(false).kind).toBe("action_required");
    expect(samStatusItem(true).kind).toBe("working");
  });

  it("maps blocked automation to Failed", () => {
    const item = automationStatusItem({
      state: "blocked",
      headline: "Blocked",
      detail: "The AI key was rejected.",
    });
    expect(item.kind).toBe("failed");
    expect(item.actionLabel).toBe("Open automation health");
  });
});
