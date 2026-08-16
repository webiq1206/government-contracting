import { describe, it, expect } from "vitest";
import {
  buildGuidedPlan,
  PLAN_STEP_COUNT,
  type GuidedPlanInput,
} from "@/lib/domain/guided-plan";

function input(over: Partial<GuidedPlanInput> = {}): GuidedPlanInput {
  return {
    stage: "scoring",
    tier: null,
    humanActionRequired: false,
    pastPerfBlocked: false,
    expired: false,
    score: null,
    hasAnalysis: false,
    missingInfo: [],
    coverage: { trades: [] },
    quotesEntered: 0,
    outreachDraftOnly: false,
    callsEnabled: true,
    pendingCalls: 0,
    hasBid: false,
    bidAmount: null,
    packageReady: null,
    packageBlockers: [],
    needsSignature: 0,
    needsProvide: 0,
    bidSubmitted: false,
    outcome: null,
    ...over,
  };
}

function trade(name: string, over: Partial<{ found: number; contacted: number; quotes: number }> = {}) {
  return {
    trade: name,
    found: 0,
    contacted: 0,
    responded: 0,
    quotes: 0,
    followUpDue: 0,
    declined: 0,
    status: "empty" as const,
    statusLabel: "",
    ...over,
  };
}

describe("guided plan", () => {
  it("has thirteen steps and starts at scoring for a fresh record", () => {
    const plan = buildGuidedPlan(input());
    expect(plan.total).toBe(PLAN_STEP_COUNT);
    expect(plan.total).toBe(13);
    expect(plan.active?.key).toBe("score");
    expect(plan.headline).toMatch(/^Step 2 of 13/);
    expect(plan.steps[0].status).toBe("done"); // find
    expect(plan.steps.filter((s) => s.status === "upcoming").length).toBe(11);
  });

  it("puts a borderline score on the pursue step with the decision button", () => {
    const plan = buildGuidedPlan(
      input({ tier: "review", humanActionRequired: true, score: 55 })
    );
    expect(plan.active?.key).toBe("pursue");
    expect(plan.active?.status).toBe("current");
    expect(plan.active?.owner).toBe("you");
    expect(plan.active?.action).toEqual({ label: "Pursue or pass", href: "#next-step" });
  });

  it("blocks the pursue step when past performance stops automation", () => {
    const plan = buildGuidedPlan(
      input({ stage: "analysis", pastPerfBlocked: true, score: 80 })
    );
    expect(plan.active?.key).toBe("pursue");
    expect(plan.active?.status).toBe("blocked");
    expect(plan.active?.blockers?.[0].what).toMatch(/similar work/);
  });

  it("tracks per-trade progress through the prices step", () => {
    const plan = buildGuidedPlan(
      input({
        stage: "quote_entry",
        score: 82,
        hasAnalysis: true,
        coverage: {
          trades: [
            trade("HVAC", { found: 3, contacted: 3, quotes: 1 }),
            trade("Electrical", { found: 2, contacted: 2 }),
          ],
        },
        quotesEntered: 1,
      })
    );
    expect(plan.active?.key).toBe("prices");
    expect(plan.active?.detail).toBe("1 of 2 trades priced");
    expect(plan.active?.action).toEqual({ label: "Enter quotes", href: "#quotes" });
    const subsStep = plan.steps.find((s) => s.key === "subs")!;
    expect(subsStep.status).toBe("done");
    expect(subsStep.detail).toBe("2 of 2 trades have subs");
  });

  it("points the prices step at the call queue when calls are waiting", () => {
    const plan = buildGuidedPlan(
      input({
        stage: "call_queue",
        score: 82,
        hasAnalysis: true,
        pendingCalls: 2,
        coverage: { trades: [trade("HVAC", { found: 2, contacted: 2 })] },
      })
    );
    expect(plan.active?.action).toEqual({ label: "Start calling", href: "/call-queue" });
  });

  it("hands the prices step to the subs on an email-only account with nothing to enter", () => {
    const plan = buildGuidedPlan(
      input({
        stage: "quote_entry",
        score: 82,
        hasAnalysis: true,
        callsEnabled: false,
        coverage: { trades: [trade("HVAC", { found: 2, contacted: 2 })] },
      })
    );
    expect(plan.active?.key).toBe("prices");
    expect(plan.active?.owner).toBe("subs");
  });

  it("blocks the contact step when outreach never actually sent", () => {
    const plan = buildGuidedPlan(
      input({
        stage: "outreach",
        score: 82,
        hasAnalysis: true,
        outreachDraftOnly: true,
        coverage: { trades: [trade("HVAC", { found: 2 })] },
      })
    );
    expect(plan.active?.key).toBe("contact");
    expect(plan.active?.status).toBe("blocked");
    expect(plan.active?.action?.href).toBe("/settings/integrations");
  });

  it("surfaces missing critical info as a blocked step behind the current one", () => {
    const plan = buildGuidedPlan(
      input({
        stage: "quote_entry",
        score: 82,
        hasAnalysis: true,
        missingInfo: [{ what: "Attachment B (pricing sheet) is missing", how: "Download it from SAM" }],
        coverage: { trades: [trade("HVAC", { found: 2, contacted: 2 })] },
      })
    );
    const missing = plan.steps.find((s) => s.key === "missing")!;
    expect(missing.status).toBe("blocked");
    expect(missing.blockers?.[0].how).toBe("Download it from SAM");
    // The live position stays with the stage; the gap does not yank it back.
    expect(plan.active?.key).toBe("prices");
  });

  it("walks the endgame: checklist blockers, then submit, then the result", () => {
    const base = {
      stage: "bid_building",
      score: 90,
      hasAnalysis: true,
      coverage: { trades: [trade("HVAC", { found: 2, contacted: 2, quotes: 1 })] },
      quotesEntered: 1,
      hasBid: true,
      bidAmount: 125000,
    };
    const blockedPlan = buildGuidedPlan(
      input({
        ...base,
        packageReady: false,
        packageBlockers: ['Sign "SF-1449 (offer form)" (prefilled), then mark it complete.'],
      })
    );
    expect(blockedPlan.active?.key).toBe("checklist");
    expect(blockedPlan.active?.status).toBe("blocked");
    expect(blockedPlan.active?.blockers?.[0].href).toBe("#submission");

    const readyPlan = buildGuidedPlan(input({ ...base, packageReady: true }));
    expect(readyPlan.active?.key).toBe("submit");
    expect(readyPlan.done).toBe(11);

    const submittedPlan = buildGuidedPlan(
      input({ ...base, stage: "submitted", packageReady: true, bidSubmitted: true })
    );
    expect(submittedPlan.active?.key).toBe("result");
    expect(submittedPlan.active?.owner).toBe("agency");
    expect(submittedPlan.active?.detail).toMatch(/Waiting for the agency/);
  });

  it("marks every step done on a won record", () => {
    const plan = buildGuidedPlan(
      input({ stage: "won", score: 90, hasAnalysis: true, hasBid: true, bidSubmitted: true, outcome: "won" })
    );
    expect(plan.done).toBe(13);
    expect(plan.active).toBeUndefined();
    expect(plan.headline).toBe("All 13 steps are done");
    expect(plan.steps.find((s) => s.key === "result")?.detail).toBe("Won");
  });

  it("closes the plan instead of faking a position for dismissed and expired records", () => {
    const dismissed = buildGuidedPlan(input({ stage: "dismissed", score: 40 }));
    expect(dismissed.closed?.label).toBe("Dismissed");
    expect(dismissed.active).toBeUndefined();

    const expired = buildGuidedPlan(input({ stage: "quote_entry", score: 70, expired: true }));
    expect(expired.closed?.label).toBe("Expired");
    expect(expired.active).toBeUndefined();
  });

  it("names each unpriced trade once a bid exists", () => {
    const plan = buildGuidedPlan(
      input({
        stage: "bid_building",
        score: 85,
        hasAnalysis: true,
        hasBid: true,
        bidAmount: 90000,
        packageReady: false,
        coverage: {
          trades: [
            trade("Roofing", { found: 2, contacted: 2, quotes: 1 }),
            trade("Sheet Metal", { found: 1, contacted: 1 }),
          ],
        },
        quotesEntered: 1,
      })
    );
    const prices = plan.steps.find((s) => s.key === "prices")!;
    expect(prices.status).toBe("blocked");
    expect(prices.blockers?.[0].what).toBe("Sheet Metal still has no price.");
  });

  it("falls back to signature and provide counts when validation has no blocker list", () => {
    const plan = buildGuidedPlan(
      input({
        stage: "bid_building",
        score: 85,
        hasAnalysis: true,
        hasBid: true,
        bidAmount: 90000,
        packageReady: false,
        needsSignature: 2,
        needsProvide: 1,
        coverage: { trades: [trade("HVAC", { found: 1, contacted: 1, quotes: 1 })] },
        quotesEntered: 1,
      })
    );
    const checklist = plan.steps.find((s) => s.key === "checklist")!;
    expect(checklist.blockers).toHaveLength(2);
    expect(checklist.blockers?.[0].what).toMatch(/2 documents still need your signature/);
    expect(checklist.blockers?.[1].what).toMatch(/1 required item only you can supply/);
  });
});
