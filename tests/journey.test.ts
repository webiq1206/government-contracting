import { describe, it, expect } from "vitest";
import {
  journeySteps,
  deriveStep,
  hasActiveSubcontractors,
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
  it("does not infer completion before the saved stage", () => {
    const steps = journeySteps("call_queue");
    const byStage = Object.fromEntries(steps.map((s) => [s.stage, s.status]));
    expect(byStage.monitoring).toBe("unverified");
    expect(byStage.outreach).toBe("unverified");
    expect(byStage.call_queue).toBe("current");
    expect(byStage.quote_entry).toBe("upcoming");
    expect(byStage.submitted).toBe("upcoming");
  });

  it("does not infer prior work from won and lost outcomes", () => {
    for (const terminal of ["won", "lost"]) {
      expect(journeySteps(terminal).every((s) => s.status === "unverified")).toBe(true);
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
  it.each([true, false])("keeps missing analysis ahead of a fresh notice timestamp (human flag %s)", (humanActionRequired) => {
    const step = deriveStep(input({ humanActionRequired, hoursSinceUpdate: 0,
      riskFlags: ["incomplete_solicitation", "missing_attachments", "awaiting_document_analysis"] }));
    expect(step.waitingOn).toBe("you");
    expect(step.title).toBe("Review the analysis blockers");
    expect(step.anchor).toBe("#attachments");
    expect(JSON.stringify(step)).not.toMatch(/No action required|is reading|starts automatically|then emails/i);
  });

  it("respects a human analysis hold even when no reason flag survived", () => {
    expect(deriveStep(input({ humanActionRequired: true })).title).toBe("Review the analysis blockers");
  });

  it("does not turn an unrelated nonblocking risk into an analysis hold", () => {
    expect(deriveStep(input({ riskFlags: ["possible_high_value_contract"] })).waitingOn).toBe("system");
  });

  it.each([true, false])("does not offer calls or claim emails exist when no active subs remain (calls %s)", (callsEnabled) => {
    const step = deriveStep(input({ stage: "call_queue", callsEnabled,
      hasActiveSubs: false, pendingCallCount: 1, requiredTradeCount: 2 }));
    expect(step.title).toBe("Find subcontractors before requesting prices");
    expect(step.anchor).toBe("#coverage");
    expect(step.href).toBeUndefined();
    expect(step.waitingOn).toBe("you");
    expect(JSON.stringify(step)).not.toMatch(/ready to be called|emailed prices|waiting on subcontractor replies/i);
  });

  it.each([undefined, 0])("requires positive pending-call evidence instead of inferring it from stage (%s)", (pendingCallCount) => {
    const step = deriveStep(input({ stage: "call_queue", hasActiveSubs: true, pendingCallCount }));
    expect(step.anchor).toBe("#coverage");
    expect(step.href).toBeUndefined();
    expect(step.why).not.toContain("Subs are ready");
  });

  it("routes recorded calls to this opportunity's queue without asserting contact verification", () => {
    const step = deriveStep(input({ stage: "call_queue", hasActiveSubs: true,
      pendingCallCount: 2, opportunityId: "synthetic-opportunity" }));
    expect(step.href).toBe("/call-queue?opportunity=synthetic-opportunity");
    expect(step.title).toBe("Review the pending calls");
    expect(step.why).not.toContain("Subs are ready");
  });

  it.each(["archived", "closed"])("keeps %s history above current analysis or contact warnings", (status) => {
    const step = deriveStep(input({ status, humanActionRequired: true,
      riskFlags: ["incomplete_solicitation"], hasActiveSubs: false }));
    expect(step.closedLabel).toBeTruthy();
    expect(step.anchor).toBeUndefined();
  });

  it("keeps existing complete quotes ahead of unnecessary subcontractor sourcing", () => {
    const step = deriveStep(input({ stage: "call_queue", hasActiveSubs: false,
      hasQuotes: true, requiredTradeCount: 2, tradeCoverageUncovered: 0 }));
    expect(step.anchor).toBe("#submission");
  });
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
    const step = deriveStep(input({ stage: "call_queue", automationPaused: true, hasActiveSubs: true, pendingCallCount: 1 }))!;
    expect(step.title).toMatch(/review the pending calls/i);
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

  it("uses present-tense labels for the current journey chip", () => {
    const current = journeySteps("scoring").find((s) => s.status === "current")!;
    expect(current.label).toBe("Scoring");
    const done = journeySteps("analysis", { completion: { scoring: true } }).find((s) => s.stage === "scoring")!;
    expect(done.label).toBe("Scored");
  });

  it("splits monitoring vs scoring copy", () => {
    expect(deriveStep(input({ stage: "monitoring" })).title).toMatch(/preparing/i);
    expect(deriveStep(input({ stage: "scoring" })).title).toMatch(/scoring/i);
  });

  it("warns when outreach is draft-only instead of waiting on subs", () => {
    const step = deriveStep(
      input({ stage: "outreach", outreachDraftOnly: true })
    )!;
    expect(step.waitingOn).toBe("you");
    expect(step.href).toBe("/settings/integrations");
  });

  it("uses stalled risk-flag reasoning when present", () => {
    const step = deriveStep(
      input({
        stage: "analysis",
        hoursSinceUpdate: 0,
        riskFlags: ["stalled_analysis"],
      })
    )!;
    expect(step.tone).toBe("warn");
    expect(step.why).toMatch(/solicitation analysis/i);
  });

  it("includes what happens next on won", () => {
    expect(deriveStep(input({ stage: "won" })).after).toBeTruthy();
  });
});

describe("current subcontractor pairings", () => {
  it("does not count empty, removed, declined or unavailable history as active", () => {
    expect(hasActiveSubcontractors([])).toBe(false);
    expect(hasActiveSubcontractors([
      { removed_at: "2026-10-01", outreach_state: "pending" },
      { removed_at: null, outreach_state: "declined" },
      { removed_at: null, outreach_state: "not_a_fit" },
      { removed_at: null, outreach_state: "unavailable" },
    ])).toBe(false);
  });
  it("recognizes a current pairing without claiming it is callable or verified", () => {
    expect(hasActiveSubcontractors([{ removed_at: null, outreach_state: "pending" }])).toBe(true);
  });
  it("leaves absence unknown when historical pairings fill the bounded read", () => {
    const history = Array.from({ length: 300 }, () => ({ removed_at: "2026-10-01", outreach_state: "pending" }));
    expect(hasActiveSubcontractors(history)).toBeUndefined();
    expect(hasActiveSubcontractors([...history, { removed_at: null, outreach_state: "pending" }])).toBe(true);
  });
});

describe("closed record presentation", () => {
  it.each(["archived", "closed"])("never revives the saved call stage for %s status", (status) => {
    const step = deriveStep(input({ status, stage: "call_queue", hasBid: true, humanActionRequired: true }));
    expect(step.closedLabel).toBe(status === "archived" ? "Archived" : "Closed");
    expect(step.decision).toBeUndefined();
    expect(step.anchor).toBeUndefined();
    expect(step.href).toBe("/pipeline");
    expect(step.why).not.toMatch(/expired|deadline passed|automatically/i);
  });
  it("keeps a verified expiry reason", () => {
    const step = deriveStep(input({ status: "archived", stage: "call_queue", expired: true }));
    expect(step.closedLabel).toBe("Expired");
    expect(step.title).toBe("Nothing, this one expired");
  });
});
