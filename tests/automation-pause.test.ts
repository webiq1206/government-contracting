/**
 * Master pause switch: when paused, enqueue and outreach sends must no-op.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const accountPaused = vi.fn(async () => false);
const platformPaused = vi.fn(async () => false);

vi.mock("../lib/app-settings", () => ({
  isAutomationPaused: (...args: unknown[]) => accountPaused(...args),
  isAutomationStopped: (...args: unknown[]) => accountPaused(...args),
  isPlatformAutomationPaused: (...args: unknown[]) => platformPaused(...args),
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
import { readFileSync } from "node:fs";

describe("master automation pause", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    accountPaused.mockResolvedValue(false);
    platformPaused.mockResolvedValue(false);
    await stopQueue();
  });

  afterEach(async () => {
    await stopQueue();
  });

  it("enqueue returns null when paused", async () => {
    accountPaused.mockResolvedValue(true);
    const { runWithOrg } = await import("../lib/tenant-context");
    const id = await runWithOrg("11111111-1111-4111-8111-111111111111", () =>
      enqueue("outreach", { trigger: "test" })
    );
    expect(id).toBeNull();
  });

  it("enqueue returns null when the platform kill switch is paused", async () => {
    platformPaused.mockResolvedValue(true);
    const id = await enqueue("outreach", { trigger: "test" });
    expect(id).toBeNull();
  });

  it("enqueue works when running", async () => {
    accountPaused.mockResolvedValue(false);
    const id = await enqueue("outreach", { trigger: "test" });
    expect(id).toBe("job-1");
  });

  it("the platform scheduler never reads one tenant's pause switch", () => {
    const source = readFileSync("worker/scheduler.ts", "utf8");
    expect(source).toContain("getPlatformAutomationState");
    expect(source).not.toMatch(/\bgetAutomationState\b/);
  });

  it("sendOutreachEmail refuses when paused", async () => {
    accountPaused.mockResolvedValue(true);
    const res = await sendOutreachEmail({
      to: "sub@example.com",
      subject: "Hi",
      html: "<p>Hi</p>",
      orgId: "11111111-1111-4111-8111-111111111111",
    });
    expect(res.disabled).toBe(true);
    expect(res.error).toMatch(/paused/i);
    expect(gmail.send).not.toHaveBeenCalled();
  });

  it("fails closed when worker outreach has no owning account", async () => {
    const res = await sendOutreachEmail({
      to: "sub@example.com",
      subject: "Hi",
      html: "<p>Hi</p>",
    });

    expect(res.blocked).toBe(true);
    expect(res.error).toMatch(/account that owns this outreach/i);
    expect(gmail.send).not.toHaveBeenCalled();
  });

  it("checks the explicitly targeted account instead of the ambient account", async () => {
    const targetOrg = "22222222-2222-4222-8222-222222222222";
    const ambientOrg = "11111111-1111-4111-8111-111111111111";
    const { currentOrgId, runWithOrg } = await import("../lib/tenant-context");
    accountPaused.mockImplementation(async () => currentOrgId() === targetOrg);

    const res = await runWithOrg(ambientOrg, () =>
      sendOutreachEmail({
        to: "sub@example.com",
        subject: "Hi",
        html: "<p>Hi</p>",
        orgId: targetOrg,
      })
    );

    expect(res.disabled).toBe(true);
    expect(res.error).toMatch(/paused/i);
    expect(gmail.send).not.toHaveBeenCalled();
  });
});
