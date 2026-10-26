/**
 * Sweeps ask each account for its zone before they claim or send.
 *
 * The handlers call the real Intl gate. An unset zone is America/Boise.
 * The same UTC instant can be open for New York and closed for Los Angeles.
 * The mailbox is mocked, so an open run with no due rows sends nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendOutreachEmail = vi.hoisted(() => vi.fn(async () => ({ provider: "gmail", messageId: "m1" })));
const isConnected = vi.hoisted(() => vi.fn(async () => false));
const orgsToSweep = vi.hoisted(() =>
  vi.fn(async () => ({ orgs: [] as { id: string; name: string }[], error: null, soloFallback: false, pausedCount: 0 }))
);
const loadAwardCompliance = vi.hoisted(() => vi.fn(async () => [] as unknown[]));
const needsAttentionOnWonWork = vi.hoisted(() => vi.fn(() => false));
const query = vi.hoisted(() => vi.fn(async () => [] as unknown[]));
const queryOne = vi.hoisted(() => vi.fn(async () => null as { timezone?: string | null; n?: number } | null));

vi.mock("../lib/integrations/email-transport", () => ({
  sendOutreachEmail,
  OUTREACH_SENDER: "Fixture <ops@example.test>",
  OUTREACH_EMAIL: "ops@example.test",
}));
vi.mock("../lib/integrations/gmail", () => ({
  gmail: {
    isConnected,
    threadMessageId: async () => ({ rfc822MessageId: "<orig@mail.gmail.com>", references: [] }),
  },
}));
vi.mock("../lib/db", () => ({
  query,
  queryOne,
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
  needsAttentionOnWonWork,
}));
vi.mock("../lib/queue", () => ({ enqueue: vi.fn(async () => undefined) }));

import { outreachFollowup, outreachRecoverySweep } from "../lib/agents/maintenance";
import { subOnboarding } from "../lib/agents/sub-onboarding";

const CLOSED = new Date("2026-10-26T06:00:00.000Z");
const OPEN = new Date("2026-10-26T15:30:00.000Z");
const SPLIT = new Date("2026-10-26T14:30:00.000Z");
const ctx = { runId: "run-window", trigger: "cron" as const, payload: { opportunityId: "opp-1" } };
const oneAccount = { orgs: [{ id: "org-1", name: "Fixture" }], error: null, soloFallback: false, pausedCount: 0 };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(CLOSED);
  sendOutreachEmail.mockClear();
  orgsToSweep.mockReset();
  orgsToSweep.mockResolvedValue({ orgs: [], error: null, soloFallback: false, pausedCount: 0 });
  loadAwardCompliance.mockReset();
  loadAwardCompliance.mockResolvedValue([]);
  needsAttentionOnWonWork.mockReset();
  needsAttentionOnWonWork.mockReturnValue(false);
  query.mockReset();
  query.mockResolvedValue([]);
  queryOne.mockReset();
  queryOne.mockResolvedValue(null);
  isConnected.mockReset();
  isConnected.mockResolvedValue(false);
});

afterEach(() => {
  vi.useRealTimers();
});

const chaseable = {
  opportunityId: "opp-1",
  opportunityTitle: "Cooling upgrade",
  contractId: "contract-1",
  orgId: "org-1",
  subcontractorId: "sub-1",
  companyName: "Builder Co",
  email: "sub@example.test",
  emailVerified: true,
  namedOnContract: true,
  assessment: {
    clearedForAward: false,
    missing: ["w9"],
    expired: [],
    expiringSoon: [],
    awaitingVerification: [],
    blockReason: "no W-9 on file",
  },
};

function dueRow(id: string, subcontractorId: string, state: string | null, city: string | null = null) {
  return {
    id,
    subcontractor_id: subcontractorId,
    opportunity_id: "opp-1",
    email: `${subcontractorId}@example.test`,
    email_verified: true,
    sub_state: state,
    sub_city: city,
  };
}

function stuckRow(subcontractorId: string, state: string | null, city: string | null = null) {
  return {
    opportunity_id: "opp-1",
    subcontractor_id: subcontractorId,
    trade: "electrical",
    outreach_state: "draft",
    sub_state: state,
    sub_city: city,
  };
}

describe("outreach workers use the recipient zone before they claim", () => {
  it("does not claim a follow-up when an unknown recipient falls back to a closed Boise morning", async () => {
    orgsToSweep.mockResolvedValue(oneAccount);
    query.mockImplementation(async (sql: string) => {
      if (String(sql).includes("c.follow_up_at <= now()")) return [dueRow("comm-1", "sub-1", null)];
      return [];
    });
    const result = await outreachFollowup.handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("Held for America/Boise weekday business hours");
    expect(result.data).toMatchObject({
      sent: 0,
      due: 1,
      lastCalls: 0,
      held: 0,
      failures: 0,
      deferredUntilWindow: true,
    });
    expect(orgsToSweep).toHaveBeenCalledWith("outreach-followup");
    expect(query.mock.calls.some((call) => String(call[0]).includes("returning id"))).toBe(false);
    expect(sendOutreachEmail).not.toHaveBeenCalled();
  });

  it("does not re-queue recovery for an unknown recipient while Boise is closed", async () => {
    orgsToSweep.mockResolvedValue(oneAccount);
    query.mockImplementation(async (sql: string) => {
      if (String(sql).includes("outreach_state in")) return [stuckRow("sub-1", null)];
      return [];
    });
    const result = await outreachRecoverySweep.handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("America/Boise");
    expect(result.enqueued).toEqual([]);
    expect(isConnected).not.toHaveBeenCalled();
  });

  it("claims the New York recipient and leaves the Los Angeles recipient due at one instant", async () => {
    vi.setSystemTime(SPLIT);
    orgsToSweep.mockResolvedValue(oneAccount);
    queryOne.mockImplementation(async (sql: string) =>
      String(sql).includes("from organizations") ? { timezone: "America/Los_Angeles" } : null
    );
    query.mockImplementation(async (sql: string, params?: unknown[]) => {
      const text = String(sql);
      if (text.includes("c.follow_up_at <= now()")) {
        return [dueRow("comm-ny", "sub-ny", "NY"), dueRow("comm-ca", "sub-ca", "CA")];
      }
      if (text.includes("returning id")) return [{ id: params?.[0] }];
      return [];
    });
    await outreachFollowup.handler(ctx);
    const claims = query.mock.calls
      .filter((call) => String(call[0]).includes("returning id"))
      .map((call) => String(call[1]?.[0]));
    expect(claims).toEqual(["comm-ny"]);
    expect(sendOutreachEmail).not.toHaveBeenCalled();
  });

  it("uses Chicago for an unknown recipient and Boise when the account zone is unset", async () => {
    vi.setSystemTime(SPLIT);
    orgsToSweep.mockResolvedValue({
      orgs: [
        { id: "org-chi", name: "Central" },
        { id: "org-boise", name: "Unset" },
      ],
      error: null,
      soloFallback: false,
      pausedCount: 0,
    });
    queryOne.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (!String(sql).includes("from organizations")) return null;
      return { timezone: String(params?.[0]) === "org-chi" ? "America/Chicago" : null };
    });
    query.mockImplementation(async (sql: string, params?: unknown[]) => {
      const text = String(sql);
      if (text.includes("c.follow_up_at <= now()")) return [dueRow("comm-1", "sub-1", null)];
      if (text.includes("returning id")) return [{ id: params?.[0] }];
      return [];
    });
    await outreachFollowup.handler(ctx);
    const claims = query.mock.calls
      .filter((call) => String(call[0]).includes("returning id"))
      .map((call) => String(call[1]?.[1]));
    expect(claims).toEqual(["org-chi"]);

    query.mockClear();
    isConnected.mockResolvedValue(true);
    query.mockImplementation(async (sql: string) => {
      if (String(sql).includes("outreach_state in")) return [stuckRow("sub-1", null)];
      return [];
    });
    const recovery = await outreachRecoverySweep.handler(ctx);
    expect(recovery.enqueued?.map((item) => item.payload.subcontractorId)).toEqual(["sub-1"]);
    expect(recovery.enqueued).toHaveLength(1);
    expect(recovery.summary).toContain("left unqueued");
  });

  it("does not chase paperwork on a weekend morning", async () => {
    vi.setSystemTime(new Date("2026-10-24T16:00:00.000Z"));
    needsAttentionOnWonWork.mockReturnValue(true);
    loadAwardCompliance.mockResolvedValue([chaseable]);
    const result = await subOnboarding.handler(ctx);
    expect(result.summary).toContain("weekday business hours");
    expect(result.humanActionRequired).toBeFalsy();
    expect(sendOutreachEmail).not.toHaveBeenCalled();
  });

  it("passes an in-window follow-up run through to the org sweep", async () => {
    vi.setSystemTime(OPEN);
    orgsToSweep.mockResolvedValue(oneAccount);
    const result = await outreachFollowup.handler(ctx);
    expect(result.summary ?? "").not.toContain("Held for America/Boise");
    expect(query).toHaveBeenCalled();
    expect(sendOutreachEmail).not.toHaveBeenCalled();
  });

  it("passes an in-window recovery run through without re-queueing an empty backlog", async () => {
    vi.setSystemTime(OPEN);
    orgsToSweep.mockResolvedValue(oneAccount);
    const result = await outreachRecoverySweep.handler(ctx);
    expect(result.summary).toContain("No stuck outreach emails");
    expect(result.enqueued).toEqual([]);
    expect(query).toHaveBeenCalled();
  });

  it("passes an in-window paperwork run through to the send", async () => {
    vi.setSystemTime(OPEN);
    needsAttentionOnWonWork.mockReturnValue(true);
    loadAwardCompliance.mockResolvedValue([chaseable]);
    await subOnboarding.handler(ctx);
    expect(loadAwardCompliance).toHaveBeenCalledWith({ opportunityId: "opp-1" });
    expect(sendOutreachEmail).toHaveBeenCalledTimes(1);
  });
});
