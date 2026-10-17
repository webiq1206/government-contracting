import { describe, expect, it } from "vitest";
import { bandBackfillSkip, bandBackfillWrite } from "@/lib/domain/band-backfill";
import { needsOutreach, needsSubFinder, needsSubVerify } from "@/lib/domain/pursuit-continuation";
import {
  pipelineStallDecision,
  pipelineStallEligible,
  pipelineStallText,
} from "@/lib/domain/pipeline-stall";

const thresholds = { pursue_min_score: 70, review_min_score: 50 };

function finished(overrides: Record<string, unknown> = {}) {
  return {
    score: 62,
    tier: "review",
    status: "open",
    stage: "scoring",
    bandDecision: null,
    riskFlags: [] as string[],
    hardExclusions: [] as string[],
    autonomous: true,
    pursuitActive: true,
    thresholds,
    ...overrides,
  };
}

describe("finished 50-69 scores with no decision", () => {
  it("decides a finished open review score once", () => {
    expect(bandBackfillSkip(finished())).toBe("decide");
    expect(bandBackfillSkip(finished({ bandDecision: "pursue" }))).toBe("skip");
    expect(bandBackfillSkip(finished({ score: 74 }))).toBe("skip");
    expect(bandBackfillSkip(finished({ riskFlags: ["incomplete_scoring"] }))).toBe("skip");
    expect(bandBackfillSkip(finished({ hardExclusions: ["ineligible_set_aside"] }))).toBe("skip");
    expect(bandBackfillSkip(finished({ autonomous: false }))).toBe("skip");
    expect(bandBackfillSkip(finished({ stage: "outreach" }))).toBe("skip");
  });

  it("starts sourcing on pursue and archives a pass without sending anything", () => {
    expect(bandBackfillWrite("pursue", "scoring", true)).toMatchObject({
      tier: "pursue",
      stage: "sub_research",
      enqueueSourcing: true,
      enqueuePricingOnly: false,
    });
    expect(bandBackfillWrite("pursue", "outreach", true).enqueueSourcing).toBe(false);
    expect(bandBackfillWrite("pursue", "scoring", false)).toMatchObject({
      stage: "quote_entry",
      enqueueSourcing: false,
      enqueuePricingOnly: true,
    });
    expect(bandBackfillWrite("pass", "scoring", true)).toEqual({
      tier: "dismiss",
      stage: "dismissed",
      status: "archived",
      humanAction: false,
      enqueueSourcing: false,
      enqueuePricingOnly: false,
    });
  });
});

describe("pursue items whose next job was never queued again", () => {
  const pursue = {
    tier: "pursue",
    status: "open",
    stage: "sub_research",
    pursuitActive: true,
    outreachAllowed: true,
    hasAnalysis: true,
    documentScoreCurrent: true,
    activePairings: 0,
  };

  it("queues sub-finder only when a pursue item has a brief and no pairing", () => {
    expect(needsSubFinder(pursue)).toBe(true);
    expect(needsSubFinder({ ...pursue, activePairings: 19 })).toBe(false);
    expect(needsSubFinder({ ...pursue, tier: "review" })).toBe(false);
    expect(needsSubFinder({ ...pursue, outreachAllowed: false })).toBe(false);
    expect(needsSubFinder({ ...pursue, stage: "scoring", documentScoreCurrent: false })).toBe(false);
    expect(needsSubFinder({ ...pursue, stage: "scoring", documentScoreCurrent: true })).toBe(true);
  });

  it("queues sub-verify for an unverified active pairing and outreach only for a verified unsent email", () => {
    expect(needsSubVerify({
      tier: "pursue",
      status: "open",
      pursuitActive: true,
      outreachAllowed: true,
      removed: false,
      verified: false,
      outreachState: "pending",
    })).toBe(true);
    expect(needsSubVerify({
      tier: "pursue",
      status: "open",
      pursuitActive: true,
      outreachAllowed: true,
      removed: false,
      verified: true,
      outreachState: "pending",
    })).toBe(false);

    const verified = {
      tier: "pursue",
      status: "open",
      pursuitActive: true,
      outreachAllowed: true,
      outboundEnabled: true,
      removed: false,
      verified: true,
      emailVerified: true,
      hasEmail: true,
      outreachState: "pending",
    };
    expect(needsOutreach(verified)).toBe(true);
    expect(needsOutreach({ ...verified, outreachState: "sent" })).toBe(false);
    expect(needsOutreach({ ...verified, outboundEnabled: false })).toBe(false);
    expect(needsOutreach({ ...verified, emailVerified: false })).toBe(false);
  });
});

describe("pipeline stall alerts", () => {
  const clear = {
    undecidedBand: 0,
    bandDecisions: 0,
    unsourcedPursue: 0,
    finderRuns: 0,
    unverifiedPairings: 0,
    verifyRuns: 0,
    unsentVerified: 0,
    outreachRuns: 0,
    outboundPaused: false,
  };

  it("alerts when eligible work is waiting and the next job has not run", () => {
    const waiting = { ...clear, unverifiedPairings: 18, verifyRuns: 0, undecidedBand: 20, bandDecisions: 0 };
    expect(pipelineStallEligible(waiting)).toBe(true);
    expect(pipelineStallDecision({ eligible: true, incidentOpen: false })).toBe("alert");
    expect(pipelineStallDecision({ eligible: true, incidentOpen: true })).toBe("alert");
    expect(pipelineStallText(waiting)).toContain("sub-verify");
    expect(pipelineStallText(waiting)).toContain("50-69");
  });

  it("does not treat a paused quote-request switch as a stalled outreach job", () => {
    expect(pipelineStallEligible({ ...clear, unsentVerified: 1, outreachRuns: 0, outboundPaused: true })).toBe(false);
  });

  it("sends the all-clear once the waiting work is gone", () => {
    expect(pipelineStallEligible(clear)).toBe(false);
    expect(pipelineStallDecision({ eligible: false, incidentOpen: true })).toBe("resolve");
    expect(pipelineStallDecision({ eligible: false, incidentOpen: false })).toBe("quiet");
  });
});
