import { describe, it, expect } from "vitest";
import {
  buildPageGuide,
  pageKeyFromPath,
  opportunityIdFromPath,
  summarizeActions,
  type GuideContextInput,
} from "@/lib/domain/page-guide";
import type { SetupChecklist } from "@/lib/domain/setup";
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
