/**
 * The two guarantees that matter when calling is turned off: no call card is
 * ever written, and the opportunity does not sit still waiting for one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const query = vi.fn(async () => []);
const queryOne = vi.fn();
const logAgent = vi.fn(async () => undefined);
const areCallsEnabled = vi.fn(async () => false);
const advancePastCallStep = vi.fn(async () => true);

vi.mock("@/lib/db", () => ({
  query: (...a: unknown[]) => query(...(a as [])),
  queryOne: (...a: unknown[]) => queryOne(...(a as [])),
  transaction: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  logAgent: (...a: unknown[]) => logAgent(...(a as [])),
}));
vi.mock("@/lib/app-settings", () => ({
  areCallsEnabled: () => areCallsEnabled(),
  getAutomationRules: vi.fn(),
  isAutomationPaused: vi.fn(async () => false),
}));
vi.mock("@/lib/domain/advance-stage", () => ({
  advancePastCallStep: (...a: unknown[]) => advancePastCallStep(...(a as [])),
  advanceIfQuotesComplete: vi.fn(),
  assessQuoteCompleteness: vi.fn(),
}));
// Call Prep must never reach Claude or the profile once the guard fires.
vi.mock("@/lib/ai/claude", () => ({
  completeJson: vi.fn(async () => {
    throw new Error("Claude must not be called when calling is off");
  }),
  ClaudeNotConfiguredError: class extends Error {},
}));
vi.mock("@/lib/ai/companyProfile", () => ({ getProfileJson: vi.fn(async () => null) }));

describe("call-prep with calling off", () => {
  beforeEach(() => {
    query.mockClear();
    queryOne.mockClear();
    logAgent.mockClear();
    advancePastCallStep.mockClear();
    areCallsEnabled.mockResolvedValue(false);
  });

  it("writes no call card and moves the opportunity on instead", async () => {
    const { callPrep } = await import("@/lib/agents/call-prep");

    const res = await callPrep.handler({
      payload: { opportunityId: "opp-1", subcontractorId: "sub-1" },
    } as never);

    expect(res.ok).toBe(true);
    expect(res.humanActionRequired).toBe(false);
    // Nothing was written at all: no card, and no lookup that precedes one.
    expect(query).not.toHaveBeenCalled();
    expect(queryOne).not.toHaveBeenCalled();
    expect(advancePastCallStep).toHaveBeenCalledWith(
      "opp-1",
      expect.objectContaining({ agent: "call-prep" })
    );
  });

  it("still reports ok when the record had already moved past the call stage", async () => {
    const { callPrep } = await import("@/lib/agents/call-prep");
    advancePastCallStep.mockResolvedValueOnce(false);

    const res = await callPrep.handler({
      payload: { opportunityId: "opp-1", subcontractorId: "sub-1" },
    } as never);

    expect(res.ok).toBe(true);
    expect(res.humanActionRequired).toBe(false);
  });

  it("prepares the card as usual when calling is on", async () => {
    const { callPrep } = await import("@/lib/agents/call-prep");
    areCallsEnabled.mockResolvedValue(true);
    // Past the guard it looks the subcontractor up; stop the test there.
    queryOne.mockResolvedValueOnce(null);

    const res = await callPrep.handler({
      payload: { opportunityId: "opp-1", subcontractorId: "sub-1" },
    } as never);

    expect(advancePastCallStep).not.toHaveBeenCalled();
    expect(queryOne).toHaveBeenCalled();
    expect(res.summary).toMatch(/not found/);
  });
});

describe("outreach with calling off", () => {
  beforeEach(() => {
    query.mockClear();
    queryOne.mockClear();
    logAgent.mockClear();
    advancePastCallStep.mockClear();
    areCallsEnabled.mockResolvedValue(false);
  });

  it("leaves a phone-only sub out rather than queueing a call for them", async () => {
    const { outreach } = await import("@/lib/agents/outreach");
    queryOne.mockResolvedValueOnce({
      id: "sub-1",
      company_name: "Acme HVAC",
      email: null,
      email_verified: false,
      phone: "555-0100",
    });

    const res = await outreach.handler({
      payload: { opportunityId: "opp-1", subcontractorId: "sub-1", trade: "HVAC" },
    } as never);

    expect(res.ok).toBe(true);
    expect(res.enqueued ?? []).toHaveLength(0);
    // No call task, and no flag that would park the opportunity on Today.
    expect(res.humanActionRequired).toBeFalsy();
    expect(query.mock.calls.map(([sql]) => sql).join("\n")).toMatch(/outreach_state = 'no_email'/);
    expect(logAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "outreach", action: "skip-phone-only" })
    );
  });

  it("queues the call for a phone-only sub when calling is on", async () => {
    const { outreach } = await import("@/lib/agents/outreach");
    areCallsEnabled.mockResolvedValue(true);
    queryOne.mockResolvedValueOnce({
      id: "sub-1",
      company_name: "Acme HVAC",
      email: null,
      email_verified: false,
      phone: "555-0100",
    });

    const res = await outreach.handler({
      payload: { opportunityId: "opp-1", subcontractorId: "sub-1", trade: "HVAC" },
    } as never);

    expect((res.enqueued ?? []).map((e) => e.agent)).toEqual(["call-prep"]);
  });
});
