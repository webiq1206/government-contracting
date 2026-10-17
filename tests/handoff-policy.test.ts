import { describe, expect, it } from "vitest";
import { HANDOFF_ATTEMPT_CAP, handoffAdmission, handoffBackoffMs } from "@/lib/domain/handoff-policy";

const now = new Date("2026-10-17T12:00:00Z");

function admit(overrides: Partial<Parameters<typeof handoffAdmission>[0]> = {}) {
  return handoffAdmission({
    finished: false,
    attempts: 0,
    lastAttemptAt: null,
    inFlight: false,
    now,
    interrupted: false,
    ...overrides,
  });
}

describe("handoff attempt cap and backoff", () => {
  it("queues a step that never started", () => {
    expect(admit()).toBe("queue");
  });

  it("skips a finished step, including one that paired nobody", () => {
    expect(admit({ finished: true, attempts: 1, interrupted: true })).toBe("skip");
  });

  it("skips a step another sweep already has in flight", () => {
    expect(admit({ inFlight: true })).toBe("skip");
  });

  it("waits 10 minutes after the first interruption and 30 after the second", () => {
    expect(handoffBackoffMs(1)).toBe(10 * 60_000);
    expect(handoffBackoffMs(2)).toBe(30 * 60_000);
    expect(handoffBackoffMs(3)).toBe(60 * 60_000);
    expect(admit({
      attempts: 1,
      interrupted: true,
      lastAttemptAt: new Date(now.getTime() - 9 * 60_000),
    })).toBe("wait");
    expect(admit({
      attempts: 1,
      interrupted: true,
      lastAttemptAt: new Date(now.getTime() - 10 * 60_000),
    })).toBe("queue");
    expect(admit({
      attempts: 2,
      interrupted: true,
      lastAttemptAt: new Date(now.getTime() - 29 * 60_000),
    })).toBe("wait");
    expect(admit({
      attempts: 2,
      interrupted: true,
      lastAttemptAt: new Date(now.getTime() - 30 * 60_000),
    })).toBe("queue");
  });

  it("caps the third interruption instead of queueing another paid lookup", () => {
    expect(HANDOFF_ATTEMPT_CAP).toBe(3);
    expect(admit({
      attempts: 3,
      interrupted: true,
      lastAttemptAt: new Date(now.getTime() - 24 * 60 * 60_000),
    })).toBe("cap");
  });
});
