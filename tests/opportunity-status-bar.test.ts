import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OpportunityStatusBar } from "../components/opportunity-status-bar";
import { buildGuidedPlan } from "../lib/domain/guided-plan";
import { deriveStep, stageLabel } from "../lib/domain/journey";

/**
 * The bar that stays on screen.
 *
 * It carried the stage and nothing else, so an operator three screens into the
 * Requirements tab could not see when the bid was due, whose it was, or that
 * automation had stopped on something. Every one of those facts was on the
 * page, at the top, past the scroll.
 *
 * The brief names nine: government deadline, stage, fit score, confidence,
 * owner, readiness, uncovered trades, blockers, and one primary next action.
 */

const BAR = readFileSync("components/opportunity-status-bar.tsx", "utf8");
const PAGE = readFileSync("app/(dash)/opportunity/[id]/page.tsx", "utf8");

describe("what it carries", () => {
  it("has all nine", () => {
    for (const [fact, marker] of [
      ["deadline", "DeadlineCountdown"],
      ["stage", "{stageLabel}"],
      ["fit score", "Fit{\" \"}"],
      ["confidence", "readConfidence"],
      ["owner", "describeOwner"],
      ["readiness", "readinessPercent"],
      ["uncovered trades", "uncoveredTrades > 0"],
      ["blockers", "flagSummary(riskFlags)"],
      ["next action", "nextAction.href"],
    ] as const) {
      expect(BAR, `missing ${fact}`).toContain(marker);
    }
  });

  it("is fed from the page rather than recomputing anything", () => {
    // The readiness, the coverage and the plan are already computed for the
    // tabs below. A second computation here would be a second answer.
    expect(PAGE).toContain("readinessPercent={readiness.percent}");
    expect(PAGE).toContain("uncoveredTrades={coverage.totals.uncovered}");
    expect(PAGE).toContain("nextAction={null}");
    expect(PAGE).toContain("<NextStepBanner opportunityId={opp.id}");
  });
});

describe("what it refuses to claim", () => {
  it("uses the resolved closed label instead of an archived record's last active stage", () => {
    // Source wiring matters: the standalone bar renders the label it receives.
    expect(PAGE).toContain("stageLabel={plan.closed?.label ?? stageLabel(opp.stage)}");
    const record = { stage: "call_queue", status: "archived", riskFlags: ["expired"] };
    const expired = record.status === "archived" && record.riskFlags.includes("expired");
    const shared = {
      stage: record.stage,
      tier: "pursue",
      humanActionRequired: false,
      pastPerfBlocked: false,
      expired,
      hasBid: false,
      bidSubmitted: false,
      outcome: null,
      callsEnabled: true,
      outreachDraftOnly: false,
    };
    const plan = buildGuidedPlan({
      ...shared,
      score: null,
      hasAnalysis: true,
      missingInfo: [],
      coverage: { trades: [] },
      quotesEntered: 0,
      pendingCalls: 0,
      bidAmount: null,
      packageReady: null,
      packageBlockers: [],
      needsSignature: 0,
      needsProvide: 0,
    });
    const step = deriveStep({ ...shared, quoteCount: 0, requiredTradeCount: 0 });
    const html = renderToStaticMarkup(createElement(OpportunityStatusBar, {
      stageLabel: plan.closed?.label ?? stageLabel(record.stage),
      deadline: null,
      score: null,
      scoreBreakdown: null,
      owner: null,
      readinessPercent: null,
      packageReady: null,
      uncoveredTrades: 0,
      riskFlags: record.riskFlags,
      nextAction: null,
    }));
    expect(plan.closed?.label).toBe("Expired");
    expect(plan.active).toBeUndefined();
    expect(step.title).toBe("Nothing, this one expired");
    expect(step.href).toBe("/pipeline");
    expect(html).toContain(">Expired</span>");
    expect(html).not.toContain("Calls to make");
    expect(html).not.toContain("/call-queue");
    expect(record.stage).toBe("call_queue");
  });

  it("does not print a dash for a deadline the notice never stated", () => {
    expect(BAR).toContain("No deadline in the notice");
  });

  it("does not call an unmeasured confidence low", () => {
    expect(BAR).toContain("Score confidence not measured");
  });

  it("does not report a readiness nobody computed", () => {
    // Zero percent ready and nobody having checked are different mornings.
    expect(BAR).toContain("Readiness not computed");
  });

  it("does not print a bare number for an unscored record", () => {
    expect(BAR).toContain('score == null ? "not scored"');
  });
});

describe("how it behaves as chrome", () => {
  it("scrolls sideways rather than growing", () => {
    // A pinned element that wraps to three lines eats the page it is pinned
    // to, which is the one thing chrome must never do.
    expect(BAR).toContain("overflow-x-auto whitespace-nowrap");
  });

  it("is labelled, because it is a region a screen reader lands in", () => {
    expect(BAR).toContain('aria-label="Opportunity status"');
  });
});
