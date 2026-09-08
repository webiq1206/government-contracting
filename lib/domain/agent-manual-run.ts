export type ManualRunRequirement = "global" | "opportunity" | "opportunity_sub" | "workflow_only";

const GLOBAL = new Set([
  "opportunity-monitor",
  "compliance-monitor",
  "learning-loop",
  "analytics-engine",
  "backlink-scout",
  "sub-onboarding",
]);

const OPPORTUNITY_SUB = new Set(["sub-verify", "outreach", "call-prep"]);

const OPPORTUNITY = new Set([
  "scoring-engine",
  "solicitation-analyst",
  "pricing-research",
  "sub-finder",
  "bid-builder",
  "compliance-auditor",
  "sources-sought-responder",
]);

/** What context the generic manual-run endpoint must receive for an agent. */
export function manualRunRequirement(agent: string): ManualRunRequirement {
  if (GLOBAL.has(agent)) return "global";
  if (OPPORTUNITY_SUB.has(agent)) return "opportunity_sub";
  if (OPPORTUNITY.has(agent)) return "opportunity";
  if (agent === "reverify") return "workflow_only";
  // Maintenance handlers and newly-added agents are not safe to expose through
  // the generic endpoint until their required context is deliberately named.
  return "workflow_only";
}

export function manualRunMissing(
  requirement: ManualRunRequirement,
  payload: Record<string, unknown>
): string | null {
  if (requirement === "global") return null;
  if (requirement === "workflow_only") {
    return "Start reverification from the opportunity so the system can create and track a verification run.";
  }
  if (typeof payload.opportunityId !== "string" || !payload.opportunityId) {
    return "Choose an opportunity before running this agent.";
  }
  if (
    requirement === "opportunity_sub" &&
    (typeof payload.subcontractorId !== "string" || !payload.subcontractorId)
  ) {
    return "Choose both an opportunity and subcontractor before running this agent.";
  }
  return null;
}
