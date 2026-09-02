/**
 * Where the solicitation brief is allowed to move the pipeline.
 *
 * The analyst used to treat every successful read as a pursue: persist the
 * brief, advance to sub research, start Sub Finder. That is correct for
 * auto-pursue and for an operator who just pressed Pursue. It is wrong for
 * review: the brief is there so a person can decide, not so sourcing starts
 * on a bid nobody chose.
 *
 * Pure.
 */

const PAST_ANALYSIS = new Set([
  "sub_research",
  "outreach",
  "call_queue",
  "quote_entry",
  "bid_building",
  "submitted",
  "won",
  "lost",
]);

export type AnalysisRouteReason =
  | "hold_review"
  | "already_advanced"
  | "prime_only"
  | "incomplete"
  | "advance";

export interface AnalysisRoute {
  stage: string;
  humanAction: boolean;
  enqueueSubFinder: boolean;
  reason: AnalysisRouteReason;
}

export function holdBriefWithoutAdvancing(opp: {
  tier?: string | null;
  stage: string;
  status?: string | null;
}): boolean {
  if (opp.status === "archived") return true;
  if (opp.tier === "review" || opp.tier === "dismiss") return true;
  if (opp.stage === "scoring" || opp.stage === "dismissed" || opp.stage === "monitoring") {
    return true;
  }
  return false;
}

/**
 * A review-time brief already exists, and the operator has now pursued.
 * Skip-if-exists used to return without starting the work pursue is for.
 */
export function shouldContinuePursueAfterExistingBrief(opp: {
  tier?: string | null;
  stage: string;
  status?: string | null;
}): boolean {
  return (
    !holdBriefWithoutAdvancing(opp) &&
    opp.tier === "pursue" &&
    opp.stage === "analysis"
  );
}

export function routeAfterAnalysis(input: {
  tier?: string | null;
  stage: string;
  status?: string | null;
  humanActionRequired: boolean;
  blockedPrime: boolean;
  blockedIncomplete: boolean;
}): AnalysisRoute {
  if (PAST_ANALYSIS.has(input.stage)) {
    return {
      stage: input.stage,
      humanAction: input.humanActionRequired,
      enqueueSubFinder: false,
      reason: "already_advanced",
    };
  }
  if (holdBriefWithoutAdvancing(input)) {
    return {
      stage: input.stage,
      humanAction: true,
      enqueueSubFinder: false,
      reason: "hold_review",
    };
  }
  if (input.blockedPrime) {
    return {
      stage: "analysis",
      humanAction: true,
      enqueueSubFinder: false,
      reason: "prime_only",
    };
  }
  if (input.blockedIncomplete) {
    return {
      stage: "analysis",
      humanAction: true,
      enqueueSubFinder: false,
      reason: "incomplete",
    };
  }
  return {
    stage: "sub_research",
    humanAction: input.humanActionRequired,
    enqueueSubFinder: true,
    reason: "advance",
  };
}
