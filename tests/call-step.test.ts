import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CALL_STAGE,
  STAGE_AFTER_CALLS,
  stageWhenCallsDisabled,
  stageIsCallOnly,
  withoutCallStage,
} from "@/lib/domain/call-step";
import { normalizeRules, DEFAULT_RULES } from "@/lib/domain/intake";
import { journeySteps, deriveStep, JOURNEY_STAGES, type StepInput } from "@/lib/domain/journey";

describe("calls_enabled rule", () => {
  it("defaults to on, so an install that never saw the setting keeps calling", () => {
    expect(DEFAULT_RULES.calls_enabled).toBe(true);
    expect(normalizeRules(null).calls_enabled).toBe(true);
    expect(normalizeRules({ min_lead_days: 5 }).calls_enabled).toBe(true);
  });

  it("only an explicit false turns calling off", () => {
    expect(normalizeRules({ calls_enabled: false }).calls_enabled).toBe(false);
    expect(normalizeRules({ calls_enabled: true }).calls_enabled).toBe(true);
  });
});

describe("stageWhenCallsDisabled", () => {
  it("sends the stages before quoting on to quote entry", () => {
    expect(stageWhenCallsDisabled("outreach")).toBe(STAGE_AFTER_CALLS);
    expect(stageWhenCallsDisabled(CALL_STAGE)).toBe(STAGE_AFTER_CALLS);
  });

  it("never drags a record backwards from a later stage", () => {
    for (const stage of ["quote_entry", "bid_building", "submitted", "won", "lost", "analysis"]) {
      expect(stageWhenCallsDisabled(stage)).toBeNull();
    }
  });
});

describe("withoutCallStage", () => {
  it("keeps the full path when calling is on", () => {
    expect(withoutCallStage(JOURNEY_STAGES, true)).toEqual([...JOURNEY_STAGES]);
  });

  it("drops only the call stage when calling is off", () => {
    const stages = withoutCallStage(JOURNEY_STAGES, false);
    expect(stages).not.toContain(CALL_STAGE);
    expect(stages).toHaveLength(JOURNEY_STAGES.length - 1);
    expect(stages).toContain("outreach");
    expect(stages).toContain("quote_entry");
  });

  it("flags the call stage as one to hide only when calling is off", () => {
    expect(stageIsCallOnly(CALL_STAGE, false)).toBe(true);
    expect(stageIsCallOnly(CALL_STAGE, true)).toBe(false);
    expect(stageIsCallOnly("outreach", false)).toBe(false);
  });
});

describe("journeySteps with calling off", () => {
  it("does not draw a call step at all", () => {
    const steps = journeySteps("outreach", { callsEnabled: false });
    expect(steps.map((s) => s.stage)).not.toContain(CALL_STAGE);
    const byStage = Object.fromEntries(steps.map((s) => [s.stage, s.status]));
    expect(byStage.outreach).toBe("current");
    expect(byStage.quote_entry).toBe("upcoming");
  });

  it("reads a record left on the call stage as being at quote entry", () => {
    const steps = journeySteps(CALL_STAGE, { callsEnabled: false });
    const byStage = Object.fromEntries(steps.map((s) => [s.stage, s.status]));
    expect(byStage.quote_entry).toBe("current");
    expect(byStage.outreach).toBe("done");
  });

  it("still marks won as fully complete on the shorter path", () => {
    const steps = journeySteps("won", { callsEnabled: false });
    expect(steps.every((s) => s.status === "done")).toBe(true);
  });
});

/** A record whose outreach email has gone out on an email-only account. */
function emailOnly(overrides: Partial<StepInput> = {}): StepInput {
  return {
    stage: "quote_entry",
    tier: "pursue",
    humanActionRequired: false,
    quoteCount: 0,
    requiredTradeCount: 2,
    hasBid: false,
    bidSubmitted: false,
    outcome: null,
    pastPerfBlocked: false,
    automationPaused: false,
    hoursSinceUpdate: 0,
    callsEnabled: false,
    ...overrides,
  };
}

describe("deriveStep with calling off", () => {
  it("never asks the operator to call from the outreach stage", () => {
    const step = deriveStep(emailOnly({ stage: "outreach" }));
    expect(step.title).not.toMatch(/call/i);
    expect(step.href).not.toBe("/call-queue");
    expect(step.waitingOn).toBe("subs");
  });

  it("waits on replies rather than demanding quote entry right after the email", () => {
    const step = deriveStep(emailOnly());
    expect(step.waitingOn).toBe("subs");
    expect(step.tone).toBe("info");
    expect(step.title).toMatch(/waiting on subcontractor replies/i);
  });

  it("asks for the remaining quotes once some pricing is in", () => {
    const step = deriveStep(emailOnly({ quoteCount: 1, tradesWithQuotes: 1, hasQuotes: true }));
    expect(step.waitingOn).toBe("you");
    expect(step.title).toMatch(/quote/i);
  });

  it("does not ask for a call on a record left in the call stage", () => {
    const step = deriveStep(emailOnly({ stage: "call_queue" }));
    expect(step.title).not.toMatch(/call/i);
    expect(step.cta).not.toMatch(/calling/i);
  });

  it("still tells the truth when automation is paused", () => {
    const step = deriveStep(emailOnly({ automationPaused: true }));
    expect(step.title).toMatch(/paused/i);
    expect(step.waitingOn).toBe("you");
  });

  it("keeps the calling copy when the preference is on or unset", () => {
    const step = deriveStep(emailOnly({ stage: "call_queue", callsEnabled: true }));
    expect(step.title).toMatch(/call/i);
    const legacy = deriveStep(emailOnly({ stage: "call_queue", callsEnabled: undefined }));
    expect(legacy.title).toMatch(/call/i);
  });
});

// ---------------------------------------------------------------------------
// The DB-facing skip: advancing past the call step, and clearing the queue.
// ---------------------------------------------------------------------------

const query = vi.fn();
const logAgent = vi.fn(async () => undefined);

// One mock each: `@/lib/db` and the modules' own `../db` resolve to the same
// file, so mocking it once covers both import styles.
vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => query(...args),
  queryOne: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  logAgent: (...args: unknown[]) => logAgent(...args),
}));

describe("advancePastCallStep", () => {
  beforeEach(() => {
    query.mockReset();
    logAgent.mockReset();
  });

  it("moves the record on and clears the human-action flag", async () => {
    const { advancePastCallStep } = await import("@/lib/domain/advance-stage");
    query.mockResolvedValueOnce([{ id: "opp-1", stage: STAGE_AFTER_CALLS }]);

    const moved = await advancePastCallStep("opp-1", { agent: "outreach" });

    expect(moved).toBe(true);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/human_action_required = false/);
    // Guarded by stage inside the statement so two agents cannot both claim it.
    expect(sql).toMatch(/stage = any/);
    expect(params).toEqual(["opp-1", STAGE_AFTER_CALLS, ["outreach", CALL_STAGE]]);
    expect(logAgent).toHaveBeenCalledTimes(1);
  });

  it("does nothing, and logs nothing, when the record has already moved past", async () => {
    const { advancePastCallStep } = await import("@/lib/domain/advance-stage");
    query.mockResolvedValueOnce([]);

    expect(await advancePastCallStep("opp-1")).toBe(false);
    expect(logAgent).not.toHaveBeenCalled();
  });
});

describe("clearCallWorkForOrg", () => {
  beforeEach(() => {
    query.mockReset();
    logAgent.mockReset();
  });

  it("empties the pending queue and moves parked opportunities on, scoped to the org", async () => {
    const { clearCallWorkForOrg } = await import("@/lib/skip-call");
    query
      .mockResolvedValueOnce([{ id: "card-1" }, { id: "card-2" }])
      .mockResolvedValueOnce([{ id: "opp-1" }]);

    const result = await clearCallWorkForOrg("org-1");

    expect(result).toEqual({ cardsSkipped: 2, opportunitiesAdvanced: 1 });
    const [cardSql, cardParams] = query.mock.calls[0];
    expect(cardSql).toMatch(/status = 'skipped'/);
    // Completed calls are history, not a task: they must survive the sweep.
    expect(cardSql).toMatch(/cc\.status = 'pending'/);
    expect(cardSql).toMatch(/o\.org_id = \$1/);
    expect(cardParams[0]).toBe("org-1");
    const [oppSql, oppParams] = query.mock.calls[1];
    expect(oppSql).toMatch(/org_id = \$1/);
    expect(oppParams).toEqual(["org-1", STAGE_AFTER_CALLS, CALL_STAGE]);
    expect(logAgent).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when there was no call work to clear", async () => {
    const { clearCallWorkForOrg } = await import("@/lib/skip-call");
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const result = await clearCallWorkForOrg("org-1");

    expect(result).toEqual({ cardsSkipped: 0, opportunitiesAdvanced: 0 });
    expect(logAgent).not.toHaveBeenCalled();
  });
});
