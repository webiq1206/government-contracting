/**
 * Master pause switch: when paused, enqueue and outreach sends must no-op.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const isPaused = vi.fn(async () => false);

vi.mock("../lib/app-settings", () => ({
  isAutomationPaused: (...args: unknown[]) => isPaused(...args),
  isAutomationStopped: (...args: unknown[]) => isPaused(...args),
  isPlatformAutomationPaused: async () => false,
  AUTOMATION_PAUSED_ERROR: "Automation is fully paused.",
  getAutomationState: vi.fn(async () => ({
    paused: false,
    changed_at: null,
    changed_by: null,
  })),
  clearAutomationStateCache: vi.fn(),
}));

vi.mock("../lib/queue/pgboss", () => ({
  createPgBossQueue: vi.fn(async () => ({
    start: vi.fn(),
    enqueue: vi.fn(async () => "job-1"),
    work: vi.fn(),
    stop: vi.fn(),
  })),
}));

vi.mock("../lib/integrations/gmail", () => ({
  gmail: {
    isConnected: vi.fn(async () => true),
    send: vi.fn(async () => ({ messageId: "g1", threadId: "t1" })),
  },
}));

vi.mock("../lib/integrations/resend", () => ({
  email: {
    enabled: vi.fn(() => true),
    send: vi.fn(async () => ({ id: "r1" })),
  },
}));

import { enqueue, stopQueue } from "../lib/queue";
import { sendOutreachEmail } from "../lib/integrations/email-transport";
import { gmail } from "../lib/integrations/gmail";

describe("master automation pause", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    isPaused.mockResolvedValue(false);
    await stopQueue();
  });

  afterEach(async () => {
    await stopQueue();
  });

  it("enqueue returns null when paused", async () => {
    isPaused.mockResolvedValue(true);
    const id = await enqueue("outreach", { trigger: "test" });
    expect(id).toBeNull();
  });

  it("enqueue works when running", async () => {
    isPaused.mockResolvedValue(false);
    const id = await enqueue("outreach", { trigger: "test" });
    expect(id).toBe("job-1");
  });

  it("sendOutreachEmail refuses when paused", async () => {
    isPaused.mockResolvedValue(true);
    const res = await sendOutreachEmail({
      to: "sub@example.com",
      subject: "Hi",
      html: "<p>Hi</p>",
    });
    expect(res.disabled).toBe(true);
    expect(res.error).toMatch(/paused/i);
    expect(gmail.send).not.toHaveBeenCalled();
  });
});
