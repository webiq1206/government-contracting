import { describe, it, expect } from "vitest";
import {
  buildPageGuide,
  pageKeyFromPath,
  opportunityIdFromPath,
  summarizeActions,
  type GuideContextInput,
} from "@/lib/domain/page-guide";
import type { SetupChecklist } from "@/lib/domain/setup";
import { buildAskUserPrompt } from "@/lib/domain/guide-ask";
import { buildNarrateUserPrompt } from "@/lib/domain/guide-narrate";
import type { StepInput } from "@/lib/domain/journey";

const completeSetup: SetupChecklist = {
  items: [
    { key: "identity", label: "Add your UEI and CAGE code", hint: "", done: true, href: "/settings/profile" },
    { key: "naics", label: "Pick your NAICS codes", hint: "", done: true, href: "/settings/profile" },
    { key: "service_areas", label: "Set service areas", hint: "", done: true, href: "/settings/profile" },
    { key: "certifications", label: "Add certifications", hint: "", done: true, href: "/settings/profile" },
    { key: "sam", label: "Connect SAM.gov", hint: "", done: true, href: "/settings/integrations" },
    { key: "claude", label: "Connect Claude", hint: "", done: true, href: "/settings/integrations" },
    { key: "googleMaps", label: "Connect Google Maps", hint: "", done: true, href: "/settings/integrations" },
    { key: "email", label: "Connect email", hint: "", done: true, href: "/settings/integrations" },
  ],
  done: 8,
  total: 8,
  complete: true,
};

const incompleteSetup: SetupChecklist = {
  ...completeSetup,
  complete: false,
  done: 6,
  items: completeSetup.items.map((i) =>
    i.key === "identity" || i.key === "naics" ? { ...i, done: false } : i
  ),
};

function emptyActions() {
  return {
    urgent: 0,
    triage: 0,
    calls: 0,
    bidWork: 0,
    subFollowUps: 0,
    quoteReviews: 0,
    compliance: 0,
    approvals: 0,
    totalActions: 0,
  };
}

function stepInput(overrides: Partial<StepInput> = {}): StepInput {
  return {
    stage: "call_queue",
    tier: "pursue",
    humanActionRequired: false,
    quoteCount: 0,
    requiredTradeCount: 2,
    tradesWithQuotes: 0,
    tradeCoverageUncovered: 2,
    hasBid: false,
    bidSubmitted: false,
    outcome: null,
    pastPerfBlocked: false,
    automationPaused: false,
    hoursSinceUpdate: 0,
    ...overrides,
  };
}

function base(overrides: Partial<GuideContextInput> = {}): GuideContextInput {
  return {
    pathname: "/today",
    setup: completeSetup,
    actions: emptyActions(),
    automationPaused: false,
    experience: "familiar",
    ...overrides,
  };
}

describe("pageKeyFromPath", () => {
  it("maps known routes", () => {
    expect(pageKeyFromPath("/today")).toBe("today");
    expect(pageKeyFromPath("/opportunity/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")).toBe(
      "opportunity"
    );
    expect(pageKeyFromPath("/subs/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")).toBe("sub");
    expect(pageKeyFromPath("/settings/profile")).toBe("profile");
  });

  it("extracts opportunity ids", () => {
    expect(
      opportunityIdFromPath("/opportunity/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
    ).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });
});

describe("summarizeActions", () => {
  it("matches Today priority for first action", () => {
    const s = summarizeActions({
      urgent: [{ id: "1" }],
      triage: [{ id: "2" }],
      calls: { count: 3 },
      bidWork: [],
      subFollowUps: [],
      quoteReviews: [],
      complianceAlerts: [],
      proposedWeights: [],
      backlinkApprovals: 0,
    });
    expect(s.totalActions).toBe(5);
    expect(s.firstHref).toBe("/today#urgent");
  });
});

describe("buildPageGuide", () => {
  it("surfaces incomplete setup before other work", () => {
    const g = buildPageGuide(
      base({
        setup: incompleteSetup,
        actions: { ...emptyActions(), triage: 2, totalActions: 2 },
        experience: "new",
      })
    );
    expect(g.badgeCount).toBeGreaterThan(0);
    expect(g.steps[0]?.source).toBe("setup");
    expect(g.steps.some((s) => s.kind === "setup-identity")).toBe(true);
  });

  it("guides call_queue opportunities with a human action", () => {
    const g = buildPageGuide(
      base({
        pathname: "/opportunity/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        opportunity: {
          id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          title: "Boise VA Renovation",
          stage: "call_queue",
          score: 74,
          deadline: null,
          stepInput: stepInput(),
          readiness: {
            percent: 40,
            summary: "2 trades still need pricing.",
            attention: [],
            complete: [{ key: "scored", label: "Opportunity scored", why: "", severity: "info" }],
            actionRequired: [
              {
                key: "hvac",
                label: "HVAC pricing is still missing",
                why: "Cannot finalize the bid without every required trade.",
                who: "admin",
                severity: "action",
                href: "#coverage",
              },
            ],
            blocked: [],
          },
        },
      })
    );
    expect(g.pageKey).toBe("opportunity");
    expect(g.situation).toContain("Boise VA Renovation");
    expect(g.idle).toBe(false);
    expect(g.steps.some((s) => s.owner === "you")).toBe(true);
    expect(g.completed.length).toBeGreaterThan(0);
  });

  it("marks system-owned stages as idle for the operator", () => {
    const g = buildPageGuide(
      base({
        pathname: "/opportunity/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        opportunity: {
          id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          title: "Quiet job",
          stage: "scoring",
          score: null,
          deadline: null,
          stepInput: stepInput({ stage: "scoring" }),
        },
      })
    );
    expect(g.idle).toBe(true);
    expect(g.brostHandling.length).toBeGreaterThan(0);
    expect(g.badgeCount).toBe(0);
  });

  it("keeps Today and page guide aligned on call count", () => {
    const g = buildPageGuide(
      base({
        pathname: "/call-queue",
        actions: { ...emptyActions(), calls: 4, totalActions: 4 },
      })
    );
    expect(g.steps[0]?.title).toMatch(/4 call/);
    expect(g.steps[0]?.source).toBe("today");
    expect(g.steps[0]?.kind).toBe("open-call");
  });

  it("uses in-panel adapters for Today triage and resume", () => {
    const g = buildPageGuide(
      base({
        pathname: "/today",
        automationPaused: true,
        actions: {
          ...emptyActions(),
          triage: 1,
          totalActions: 1,
          firstTriageOpportunityId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        },
      })
    );
    expect(g.steps.some((s) => s.kind === "resume-automation")).toBe(true);
    const triage = g.steps.find((s) => s.id === "today-triage");
    expect(triage?.kind).toBe("triage");
    expect(triage?.opportunityId).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });

  it("does not invent tasks when everything is clear", () => {
    const g = buildPageGuide(base({ pathname: "/pipeline" }));
    expect(g.idle).toBe(true);
    expect(g.steps.every((s) => s.tone === "info" || s.owner !== "you")).toBe(true);
  });

  it("explains sub contact gaps", () => {
    const g = buildPageGuide(
      base({
        pathname: "/subs/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        sub: {
          id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          companyName: "ABC Mechanical",
          contactStatus: "no_email_found",
          email: null,
          phone: null,
          openJobs: 1,
          lastTouchAt: null,
          pendingOutreach: [
            {
              opportunityId: "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee",
              title: "Boise VA Renovation",
              state: "unresponsive",
            },
          ],
          missingContact: true,
        },
      })
    );
    expect(g.situation).toContain("ABC Mechanical");
    expect(g.steps.some((s) => s.id === "sub-contact" && s.kind === "edit-sub-contact")).toBe(
      true
    );
  });
});

describe("closed opportunity guide", () => {
  it.each([false, true])("suppresses call, upload, and submission work with expired=%s", (expired) => {
    const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const guide = buildPageGuide(base({ pathname: `/opportunity/${id}`, opportunity: {
      id, title: "Saved archived bid", stage: "call_queue", score: null, deadline: null,
      stepInput: stepInput({status: "archived", expired, hasBid: true}), packageReady: true, bidSubmitted: false,
      readiness: {percent: 20, summary: "Old incomplete work", attention: [], complete: [], blocked: [], actionRequired: [{key: "upload", label: "Upload a document", why: "Old requirement", severity: "action", who: "admin", action: {label: "Upload document", modal: "upload"}}]},
    }}));
    expect(guide.stageLabel).toBe(expired ? "Expired" : "Archived");
    expect(guide.steps).toHaveLength(1);
    expect(guide.steps[0]).toMatchObject({kind: "link", href: "/pipeline"});
    expect(guide.badgeCount).toBe(0);
    expect(guide.brostHandling).toEqual([]);
    expect(guide.needsAttention).toEqual([]);
    expect(guide.completed).toEqual([]);
    expect(guide.idle).toBe(false);
    expect(guide.whatHappensNext).not.toMatch(/continue automatically/i);
  });
});

it.each([['won', 'Won', '/contracts'], ['lost', 'Lost', '/today']])('keeps %s navigation while removing stale guide work', (stage, label, href) => {
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const guide = buildPageGuide(base({pathname: `/opportunity/${id}`, opportunity: {
    id, title: 'Saved outcome', stage, score: null, deadline: null,
    stepInput: stepInput({stage, status: 'archived', hasBid: true}), packageReady: true, bidSubmitted: false,
  }}));
  expect(guide.stageLabel).toBe(label);
  expect(guide.steps).toHaveLength(1);
  expect(guide.steps[0]).toMatchObject({kind: 'link', href});
  expect(guide.badgeCount).toBe(0);
  expect(guide.brostHandling).toEqual([]);
});

describe("Guide current facts versus saved scoring prose", () => {
  it.each([67, null])("does not promote saved prose to current advice with score %s", score => {
    const id="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const summary="Historical prose says 75 points, AUTO-PURSUE and strong deadline runway.";
    const guide=buildPageGuide(base({pathname:`/opportunity/${id}`,opportunity:{id,title:"Synthetic current record",stage:"scoring",score,deadline:"2026-10-06T22:00:00Z",
      stepInput:stepInput({stage:"scoring",tier:"review",humanActionRequired:true}),
      scoreExplain:{total:67,summary,factors:[{label:"Deadline",points:10,max:10,reasoning:"Weeks remaining"}]}}}));
    expect(guide.scoreLine).toContain(score===null ? "Current score unavailable" : "Current recorded score: 67/100");
    expect(guide.scoreLine).not.toContain(summary);
    expect(guide.situation).toContain("Oct 6, 2026"); expect(guide.situation).toContain("UTC");
    expect(guide.scoreExplain?.summary).toBe(summary);
    expect(guide.scoreExplain?.freshnessNote).toContain("not been verified");
    expect(buildAskUserPrompt({guide,question:"What should I do?",history:[]})).not.toContain(summary);
    expect(buildNarrateUserPrompt(guide)).not.toContain(summary);
  });
  it("distinguishes a different saved analysis total without modifying it", () => {
    const id="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const guide=buildPageGuide(base({pathname:`/opportunity/${id}`,opportunity:{id,title:"Closed history",stage:"call_queue",score:67,deadline:null,
      stepInput:stepInput({status:"archived"}),scoreExplain:{total:75,summary:"Saved assessment",factors:[]}}}));
    expect(guide.scoreExplain?.total).toBe(75);
    expect(guide.scoreExplain?.freshnessNote).toContain("75 differs from the current recorded score 67");
    expect(guide.steps).toHaveLength(1); expect(guide.steps[0].kind).toBe("link");
    expect(guide.situation).toContain("No deadline recorded");
  });
});
