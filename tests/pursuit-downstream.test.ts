import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { jobsAfterFinalPursue, queuedAfterScore } from "@/lib/domain/score-downstream";
import { routeAfterAnalysis } from "@/lib/domain/analysis-routing";

describe("a pursued opportunity starts sourcing, RFQ email, and follow-up", () => {
  it("starts pricing and sub discovery after a documented pursue score", () => {
    const jobs = jobsAfterFinalPursue("opp-1");
    expect(jobs.map((job) => job.agent)).toEqual(["pricing-research", "sub-finder"]);
  });

  it("keeps preliminary pursue on analysis, then advances a pursue brief into sub discovery", () => {
    expect(queuedAfterScore("pursue", "opp-1").map((job) => job.agent)).toEqual(["solicitation-analyst"]);
    const route = routeAfterAnalysis({
      tier: "pursue",
      stage: "analysis",
      status: "open",
      humanActionRequired: false,
      blockedPrime: false,
      blockedIncomplete: false,
    });
    expect(route.enqueueSubFinder).toBe(true);
    expect(route.stage).toBe("sub_research");
  });

  it("does not start sub discovery while the item is still in review", () => {
    const route = routeAfterAnalysis({
      tier: "review",
      stage: "scoring",
      status: "open",
      humanActionRequired: true,
      blockedPrime: false,
      blockedIncomplete: false,
    });
    expect(route.enqueueSubFinder).toBe(false);
    expect(route.reason).toBe("hold_review");
  });

  it("wires sub verification to the RFQ send, and the send to a follow-up", () => {
    const scoring = readFileSync("lib/agents/scoring-engine.ts", "utf8");
    const subFinder = readFileSync("lib/agents/sub-finder.ts", "utf8");
    const subVerify = readFileSync("lib/agents/sub-verify.ts", "utf8");
    const outreach = readFileSync("lib/agents/outreach.ts", "utf8");
    const followup = readFileSync("lib/agents/maintenance.ts", "utf8");

    expect(scoring).toContain("jobsAfterFinalPursue");
    expect(subFinder).toContain('agent: "sub-verify"');
    expect(subVerify).toContain('agent: "outreach"');
    expect(outreach).toContain("followUpAt");
    expect(outreach).toContain("follow_up_at");
    expect(followup).toContain('name: "outreach-followup"');
    expect(followup).toContain("sendOutreachEmail");
  });
});

describe("outreach and follow-up tests never use a live mailbox", () => {
  it("the new recovery tests mock the mail transport", () => {
    const alert = readFileSync("tests/provider-recovery-probe.test.ts", "utf8");
    const replies = readFileSync("tests/reply-price-ledger.test.ts", "utf8");
    expect(alert).toContain("vi.mock");
    expect(alert).toContain("system-mail");
    expect(replies).not.toContain("gmail.send");
    expect(replies).toContain("proposeRow");
  });
});
