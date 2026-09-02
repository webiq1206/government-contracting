import { describe, expect, it } from "vitest";
import {
  holdBriefWithoutAdvancing,
  routeAfterAnalysis,
  shouldContinuePursueAfterExistingBrief,
} from "@/lib/domain/analysis-routing";

describe("analysis routing", () => {
  it("holds the brief on review and does not start sub sourcing", () => {
    expect(
      holdBriefWithoutAdvancing({ tier: "review", stage: "scoring", status: "open" })
    ).toBe(true);
    const route = routeAfterAnalysis({
      tier: "review",
      stage: "scoring",
      status: "open",
      humanActionRequired: true,
      blockedPrime: false,
      blockedIncomplete: false,
    });
    expect(route.enqueueSubFinder).toBe(false);
    expect(route.stage).toBe("scoring");
    expect(route.reason).toBe("hold_review");
    expect(route.humanAction).toBe(true);
  });

  it("does not start sourcing on a dismissed or archived record", () => {
    expect(
      holdBriefWithoutAdvancing({ tier: "dismiss", stage: "dismissed", status: "archived" })
    ).toBe(true);
    expect(
      routeAfterAnalysis({
        tier: "dismiss",
        stage: "dismissed",
        status: "archived",
        humanActionRequired: false,
        blockedPrime: false,
        blockedIncomplete: false,
      }).enqueueSubFinder
    ).toBe(false);
  });

  it("advances a pursue still in analysis", () => {
    const route = routeAfterAnalysis({
      tier: "pursue",
      stage: "analysis",
      status: "open",
      humanActionRequired: false,
      blockedPrime: false,
      blockedIncomplete: false,
    });
    expect(route.reason).toBe("advance");
    expect(route.stage).toBe("sub_research");
    expect(route.enqueueSubFinder).toBe(true);
  });

  it("does not pull a later stage backward", () => {
    const route = routeAfterAnalysis({
      tier: "pursue",
      stage: "outreach",
      status: "open",
      humanActionRequired: false,
      blockedPrime: false,
      blockedIncomplete: false,
    });
    expect(route.reason).toBe("already_advanced");
    expect(route.stage).toBe("outreach");
    expect(route.enqueueSubFinder).toBe(false);
  });

  it("starts pursue work when a review-time brief already exists", () => {
    expect(
      shouldContinuePursueAfterExistingBrief({
        tier: "pursue",
        stage: "analysis",
        status: "open",
      })
    ).toBe(true);
    expect(
      shouldContinuePursueAfterExistingBrief({
        tier: "review",
        stage: "scoring",
        status: "open",
      })
    ).toBe(false);
  });
});
