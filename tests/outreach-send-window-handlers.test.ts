/**
 * Night crons must leave the queue alone.
 *
 * The handlers call the real America/Boise gate. Outside the window they
 * return before claiming follow-ups, re-queueing drafts, or chasing paperwork.
 * Inside the window they proceed to the org sweep. The mailbox is mocked, so
 * an open run with no due rows sends nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendOutreachEmail = vi.hoisted(() => vi.fn(async () => ({ provider: "gmail", messageId: "m1" })));
const orgsToSweep = vi.hoisted(() =>
  vi.fn(async () => ({ orgs: [] as { id: string; name: string }[], error: null, soloFallback: false, pausedCount: 0 }))
);
const loadAwardCompliance = vi.hoisted(() => vi.fn(async () => []));

vi.mock("../lib/integrations/email-transport", () => ({
  sendOutreachEmail,
  OUTREACH_SENDER: "Fixture <ops@example.test>",
  OUTREACH_EMAIL: "ops@example.test",
}));
vi.mock("../lib/integrations/gmail", () => ({
  gmail: {
    isConnected: async () => false,
    threadMessageId: async () => ({ rfc822MessageId: "<orig@mail.gmail.com>", references: [] }),
  },
}));
vi.mock("../lib/db", () => ({
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
  transaction: async (fn: (client: unknown) => unknown) => fn({}),
}));
vi.mock("../lib/logger", () => ({ logAgent: async () => undefined }));
vi.mock("../lib/app-settings", () => ({
  getWorkExecution: async () => "sub",
  getAutomationRules: async () => ({
    followup_max: 1,
    followup_hours: 48,
    outreach_batch_limit: 50,
    work_execution: "sub",
    final_nudge_enabled: false,
    calls_enabled: false,
    rfq_outbound_enabled: true,
  }),
  areCallsEnabled: async () => false,
  isAutomationPaused: async () => false,
  isAutomationStopped: async () => false,
}));
vi.mock("../lib/ai/companyProfile", () => ({ getProfileJson: async () => ({ legal_name: "Fixture" }) }));
vi.mock("../lib/agents/org-fanout", () => ({ orgsToSweep, fanoutNote: () => null }));
vi.mock("../lib/domain/template-store", () => ({ activeTemplate: async () => null }));
vi.mock("../lib/integrations/twilio", () => ({ sms: { alert: async () => ({ disabled: true }) } }));
vi.mock("../lib/integrations/system-mail", () => ({ systemMail: { send: async () => ({ disabled: true }) } }));
vi.mock("../lib/sub-compliance-store", () => ({
  loadAwardCompliance,
  needsAttentionOnWonWork: () => false,
}));
vi.mock("../lib/queue", () => ({ enqueue: vi.fn(async () => undefined) }));

import { outreachFollowup, outreachRecoverySweep } from "../lib/agents/maintenance";
import { subOnboarding } from "../lib/agents/sub-onboarding";

const CLOSED = new Date("2026-10-26T06:00:00.000Z");
const OPEN = new Date("2026-10-26T15:30:00.000Z");
const ctx = { runId: "run-window", trigger: "cron" as const, payload: { opportunityId: "opp-1" } };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(CLOSED);
  sendOutreachEmail.mockClear();
  orgsToSweep.mockClear();
  loadAwardCompliance.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("outreach workers defer outside America/Boise weekday hours", () => {
  it("does not claim follow-ups overnight", async () => {
    const result = await outreachFollowup.handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("Held for America/Boise weekday business hours");
    expect(result.data).toMatchObject({
      sent: 0,
      due: 0,
      lastCalls: 0,
      held: 0,
      failures: 0,
      deferredUntilWindow: true,
    });
    expect(orgsToSweep).not.toHaveBeenCalled();
    expect(sendOutreachEmail).not.toHaveBeenCalled();
  });

  it("does not burn the recovery singleton overnight", async () => {
    const result = await outreachRecoverySweep.handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("America/Boise");
    expect(result.enqueued).toEqual([]);
    expect(orgsToSweep).not.toHaveBeenCalled();
  });

  it("does not chase paperwork on a weekend morning", async () => {
    vi.setSystemTime(new Date("2026-10-24T16:00:00.000Z"));
    const result = await subOnboarding.handler(ctx);
    expect(result.summary).toContain("Held for America/Boise weekday business hours");
    expect(loadAwardCompliance).not.toHaveBeenCalled();
    expect(sendOutreachEmail).not.toHaveBeenCalled();
  });

  it("passes an in-window follow-up run through to the org sweep", async () => {
    vi.setSystemTime(OPEN);
    const result = await outreachFollowup.handler(ctx);
    expect(result.summary ?? "").not.toContain("Held for America/Boise");
    expect(orgsToSweep).toHaveBeenCalledWith("outreach-followup");
    expect(sendOutreachEmail).not.toHaveBeenCalled();
  });

  it("passes an in-window recovery run through without re-queueing an empty backlog", async () => {
    vi.setSystemTime(OPEN);
    const result = await outreachRecoverySweep.handler(ctx);
    expect(result.summary).toContain("No stuck outreach emails");
    expect(result.enqueued).toEqual([]);
    expect(orgsToSweep).toHaveBeenCalledWith("outreach-recovery-sweep");
  });

  it("passes an in-window paperwork run through to the compliance read", async () => {
    vi.setSystemTime(OPEN);
    const result = await subOnboarding.handler(ctx);
    expect(result.summary).toBe("No subcontractors are attached to this contract yet.");
    expect(loadAwardCompliance).toHaveBeenCalledWith({ opportunityId: "opp-1" });
    expect(sendOutreachEmail).not.toHaveBeenCalled();
  });
});
