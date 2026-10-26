/**
 * The outreach pause stops every automatic email to a subcontractor.
 *
 * Quote requests, follow-ups, and last-call notes were already held. The
 * daily paperwork chase is the remaining scheduled send. While paused it
 * logs the skip and leaves the next day's sweep to notice the gap. It does
 * not store a claim that a later run would send.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendOutreachEmail = vi.hoisted(() => vi.fn(async () => ({ provider: "gmail", messageId: "m1" })));
const logAgent = vi.hoisted(() => vi.fn(async () => undefined));
const rules = vi.hoisted(() => ({ rfq_outbound_enabled: false }));
const query = vi.hoisted(() => vi.fn(async () => []));
const queryOne = vi.hoisted(() => vi.fn(async () => ({ n: 0 })));

vi.mock("../lib/domain/account-timezone", () => ({
  accountOutreachTimeZone: async () => "America/Boise",
  outreachSendZoneFor: async () => "America/Boise",
}));
vi.mock("../lib/domain/outreach-send-window", () => ({
  outreachWindowRefusal: () => null,
  isOutreachWindowHold: () => false,
}));
vi.mock("../lib/integrations/email-transport", () => ({ sendOutreachEmail }));
vi.mock("../lib/logger", () => ({ logAgent }));
vi.mock("../lib/app-settings", () => ({ getAutomationRules: async () => rules }));
vi.mock("../lib/db", () => ({ query, queryOne }));
vi.mock("../lib/tenant-context", () => ({
  runWithOrg: async (_orgId: string, fn: () => unknown) => fn(),
}));
vi.mock("../lib/sub-compliance-store", () => ({
  loadAwardCompliance: async () => [
    {
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
    },
  ],
  needsAttentionOnWonWork: () => true,
}));
vi.mock("../lib/agents/org-fanout", () => ({
  orgsToSweep: async () => ({ orgs: [], error: null, soloFallback: false, pausedCount: 0 }),
  fanoutNote: () => null,
}));

import { readFileSync } from "node:fs";
import { subOnboarding } from "../lib/agents/sub-onboarding";

beforeEach(() => {
  sendOutreachEmail.mockClear();
  logAgent.mockClear();
  query.mockClear();
  queryOne.mockClear();
  rules.rfq_outbound_enabled = false;
});

describe("paused paperwork requests", () => {
  it("skips the daily compliance chase and does not queue a later send", async () => {
    const result = await subOnboarding.handler({
      runId: "run-1",
      trigger: "cron",
      payload: { opportunityId: "opp-1" },
    });
    expect(sendOutreachEmail).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) => /insert into communications/.test(String(sql)))).toBe(false);
    expect(logAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "sub-onboarding",
        action: "rfq-paused",
        status: "skipped",
        subcontractorId: "sub-1",
      })
    );
    expect(result.summary).toContain("paperwork request skipped because outbound quote requests are paused");
    expect(result.humanActionRequired).toBeFalsy();
    expect(result.enqueued).toBeUndefined();
  });

  it("still sends the paperwork request when outbound mail is on", async () => {
    rules.rfq_outbound_enabled = true;
    await subOnboarding.handler({
      runId: "run-1",
      trigger: "cron",
      payload: { opportunityId: "opp-1" },
    });
    expect(sendOutreachEmail).toHaveBeenCalledTimes(1);
  });
});

describe("pause sits in front of every automatic vendor send", () => {
  it("checks the pause before the compliance chase calls the mailbox", () => {
    const source = readFileSync("lib/agents/sub-onboarding.ts", "utf8");
    const handler = source.slice(source.indexOf("export const subOnboarding"));
    const pause = handler.indexOf("rules.rfq_outbound_enabled === false");
    const chase = handler.indexOf("chase(row, needed)");
    expect(pause).toBeGreaterThan(-1);
    expect(pause).toBeLessThan(chase);
    expect(source).not.toContain("enqueue(");
  });

  it("checks the pause before a clarification is claimed", () => {
    const source = readFileSync("lib/domain/reply-clarify.ts", "utf8");
    const pause = source.indexOf("rules.rfq_outbound_enabled === false");
    const send = source.indexOf("await sendOutreachEmail");
    expect(pause).toBeGreaterThan(-1);
    expect(pause).toBeLessThan(send);
    expect(source).toContain('reason: "rfq-paused"');
    expect(source).not.toContain("enqueue(");
  });

  it("checks the pause before a decline acknowledgement is claimed", () => {
    const source = readFileSync("lib/domain/decline-closeout.ts", "utf8");
    const pause = source.indexOf("rules.rfq_outbound_enabled === false");
    const send = source.indexOf("const res = await sendEmail");
    expect(pause).toBeGreaterThan(-1);
    expect(pause).toBeLessThan(send);
    expect(source).not.toContain("enqueue(");
  });

  it("does not ask an operator to send a clarification the pause just held", () => {
    const source = readFileSync("lib/agents/maintenance.ts", "utf8");
    const gate = source.indexOf('clarify.reason !== "rfq-paused"');
    const errorLog = source.indexOf('action: "clarification-not-sent"');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(errorLog);
  });
});
