import { describe, it, expect } from "vitest";
import {
  journeySteps,
  deriveStep,
  stepHasAction,
  JOURNEY_STAGES,
  isStalled,
  STAGE_AGENT,
  type StepInput,
} from "@/lib/domain/journey";

/** A quiet mid-pipeline record; override per test. */
function input(overrides: Partial<StepInput> = {}): StepInput {
  return {
    stage: "analysis",
    tier: "pursue",
    humanActionRequired: false,
    quoteCount: 0,
    requiredTradeCount: 0,
    hasBid: false,
    bidSubmitted: false,
    outcome: null,
    pastPerfBlocked: false,
    automationPaused: false,
    hoursSinceUpdate: 0,
    ...overrides,
  };
}

describe("journeySteps", () => {
  it("marks steps done/current/upcoming around the active stage", () => {
    const steps = journeySteps("call_queue");
    const byStage = Object.fromEntries(steps.map((s) => [s.stage, s.status]));
    expect(byStage.monitoring).toBe("done");
    expect(byStage.outreach).toBe("done");
    expect(byStage.call_queue).toBe("current");
    expect(byStage.quote_entry).toBe("upcoming");
    expect(byStage.submitted).toBe("upcoming");
  });

  it("marks every step done for won and lost", () => {
    for (const terminal of ["won", "lost"]) {
      expect(journeySteps(terminal).every((s) => s.status === "done")).toBe(true);
    }
  });

  it("marks nothing current for dismissed", () => {
    expect(journeySteps("dismissed").some((s) => s.status === "current")).toBe(false);
  });

  it("covers every stage with an owner", () => {
    for (const stage of JOURNEY_STAGES) {
      const step = journeySteps(stage).find((s) => s.stage === stage)!;
      expect(["system", "you", "subs", "agency"]).toContain(step.owner);
    }
  });
});

describe("isStalled", () => {
  it("flags auto stages past their window", () => {
    expect(isStalled("scoring", 3)).toBe(true);
    expect(isStalled("scoring", 1)).toBe(false);
    expect(isStalled("outreach", 100)).toBe(true);
    expect(isStalled("outreach", 50)).toBe(false);
  });

  it("never flags human- or agency-owned stages", () => {
    expect(isStalled("call_queue", 500)).toBe(false);
    expect(isStalled("quote_entry", 500)).toBe(false);
    expect(isStalled("submitted", 500)).toBe(false);
  });

  it("treats unknown update age as not stalled", () => {
    expect(isStalled("scoring", null)).toBe(false);
  });
});

describe("deriveStep", () => {
  it("puts the borderline triage decision above everything else", () => {
    const step = deriveStep(input({ tier: "review", humanActionRequired: true }))!;
    expect(step.decision).toBe("triage");
    expect(step.waitingOn).toBe("you");
  });

  it("labels who the ball is with per stage", () => {
    expect(deriveStep(input({ stage: "analysis" }))!.waitingOn).toBe("system");
    expect(deriveStep(input({ stage: "outreach" }))!.waitingOn).toBe("subs");
    expect(deriveStep(input({ stage: "call_queue" }))!.waitingOn).toBe("you");
    expect(deriveStep(input({ stage: "submitted" }))!.waitingOn).toBe("agency");
  });

  it("tells the truth when automation is paused on a system-owned stage", () => {
    const step = deriveStep(input({ stage: "analysis", automationPaused: true }))!;
    expect(step.tone).toBe("warn");
    expect(step.title).toMatch(/paused/i);
    expect(step.href).toBe("/agents");
    expect(step.waitingOn).toBe("you");
  });

  it("does not show the paused warning on human-owned stages", () => {
    const step = deriveStep(input({ stage: "call_queue", automationPaused: true }))!;
    expect(step.title).toMatch(/call the subcontractors/i);
  });

  it("flags a stalled auto stage and deep-links to the responsible agent's log", () => {
    const step = deriveStep(input({ stage: "analysis", hoursSinceUpdate: 12 }))!;
    expect(step.tone).toBe("warn");
    expect(step.title).toMatch(/stuck/i);
    expect(step.href).toBe(`/agents?agent=${STAGE_AGENT.analysis}`);
  });

  it("prefers the paused explanation over the stalled one", () => {
    const step = deriveStep(
      input({ stage: "analysis", hoursSinceUpdate: 12, automationPaused: true })
    )!;
    expect(step.title).toMatch(/paused/i);
  });

  it("counts remaining quotes in the quote_entry copy", () => {
    const step = deriveStep(
      input({ stage: "quote_entry", quoteCount: 1, requiredTradeCount: 3 })
    )!;
    expect(step.title).toContain("1 of 3");
  });

  it("moves to submission review once a bid exists and trades are covered", () => {
    const step = deriveStep(
      input({
        stage: "quote_entry",
        quoteCount: 2,
        tradesWithQuotes: 2,
        requiredTradeCount: 2,
        tradeCoverageUncovered: 0,
        hasBid: true,
      })
    )!;
    expect(step.anchor).toBe("#submission");
  });

  it("keeps focus on required pricing when a bid exists but trades are uncovered", () => {
    const step = deriveStep(
      input({
        stage: "quote_entry",
        quoteCount: 1,
        tradesWithQuotes: 1,
        requiredTradeCount: 2,
        tradeCoverageUncovered: 1,
        hasBid: true,
      })
    )!;
    expect(step.anchor).toBe("#coverage");
  });

  it("offers the outcome decision after submission", () => {
    const step = deriveStep(input({ stage: "submitted" }))!;
    expect(step.decision).toBe("outcome");
  });

  it("keeps lost and dismissed actionable with a path out, and celebrates won", () => {
    expect(stepHasAction(deriveStep(input({ stage: "lost" })))).toBe(true);
    expect(stepHasAction(deriveStep(input({ stage: "dismissed" })))).toBe(true);
    expect(deriveStep(input({ stage: "won" })).title).toMatch(/won/i);
    expect(stepHasAction(deriveStep(input({ stage: "won" })))).toBe(true);
  });

  it("always explains what happens after an operator action", () => {
    for (const stage of ["call_queue", "quote_entry", "submitted"]) {
      expect(deriveStep(input({ stage })).after).toBeTruthy();
    }
  });

  it("always exposes a concrete action for every journey stage", () => {
    for (const stage of JOURNEY_STAGES) {
      expect(stepHasAction(deriveStep(input({ stage })))).toBe(true);
    }
    expect(stepHasAction(deriveStep(input({ expired: true })))).toBe(true);
  });
});
