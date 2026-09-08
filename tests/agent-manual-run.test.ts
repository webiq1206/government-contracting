import { describe, expect, it } from "vitest";
import { ROSTER } from "@/lib/agents/registry";
import {
  manualRunMissing,
  manualRunRequirement,
} from "@/lib/domain/agent-manual-run";

describe("manual agent run requirements", () => {
  it("classifies every dashboard agent deliberately", () => {
    const expected = new Map([
      ["opportunity-monitor", "global"],
      ["scoring-engine", "opportunity"],
      ["solicitation-analyst", "opportunity"],
      ["pricing-research", "opportunity"],
      ["sub-finder", "opportunity"],
      ["sub-verify", "opportunity_sub"],
      ["outreach", "opportunity_sub"],
      ["call-prep", "opportunity_sub"],
      ["bid-builder", "opportunity"],
      ["compliance-auditor", "opportunity"],
      ["compliance-monitor", "global"],
      ["learning-loop", "global"],
      ["analytics-engine", "global"],
      ["reverify", "workflow_only"],
      ["sources-sought-responder", "opportunity"],
      ["backlink-scout", "global"],
      ["sub-onboarding", "global"],
    ]);

    expect(ROSTER.map((agent) => agent.name).sort()).toEqual([...expected.keys()].sort());
    for (const [agent, requirement] of expected) {
      expect(manualRunRequirement(agent)).toBe(requirement);
    }
  });

  it("blocks contextual agents until every required record is named", () => {
    expect(manualRunMissing("opportunity", {})).toContain("opportunity");
    expect(manualRunMissing("opportunity_sub", { opportunityId: "opp-1" })).toContain(
      "subcontractor"
    );
    expect(
      manualRunMissing("opportunity_sub", {
        opportunityId: "opp-1",
        subcontractorId: "sub-1",
      })
    ).toBeNull();
  });

  it("fails closed for an unclassified or workflow-only agent", () => {
    expect(manualRunRequirement("new-agent-with-no-contract")).toBe("workflow_only");
    expect(manualRunMissing("workflow_only", {})).toContain("opportunity");
  });

  it("allows only declared sweep agents to run without record context", () => {
    expect(manualRunMissing(manualRunRequirement("opportunity-monitor"), {})).toBeNull();
    expect(manualRunMissing(manualRunRequirement("bid-builder"), {})).not.toBeNull();
  });
});
