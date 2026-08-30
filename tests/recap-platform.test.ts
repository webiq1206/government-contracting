import { describe, expect, it } from "vitest";
import { buildPlatformRecap, type PlatformRecapFacts } from "@/lib/recap/platform";
import { renderRecapEmail } from "@/lib/domain/recap/email";

const NOW = new Date("2026-08-30T13:00:00Z");

function facts(over: Partial<PlatformRecapFacts> = {}): PlatformRecapFacts {
  return {
    brokenIntegrations: [],
    failingAgents: [],
    mailTrouble: [],
    quietAccounts: [],
    accounts: 0,
    activeAccounts: 0,
    emailsSent: 0,
    emailsFailed: 0,
    jobRuns: 0,
    jobFailures: 0,
    newOpportunities: 0,
    bidsSubmitted: 0,
    ...over,
  };
}

const ctx = { localDate: "2026-08-29", timezone: "America/Denver", now: NOW };

describe("the platform recap", () => {
  it("belongs to no account, so a tenant filter can never leak into it", () => {
    const recap = buildPlatformRecap(facts(), ctx);
    expect(recap.scope).toBe("platform");
    expect(recap.orgId).toBeNull();
  });

  it("treats one account's mail failures as urgent for the operator", () => {
    const recap = buildPlatformRecap(
      facts({
        mailTrouble: [
          { orgId: "org-1", orgName: "Northside Builders", failed: 9 },
        ],
      }),
      ctx
    );
    const urgent = recap.sections.find((s) => s.key === "urgent")!;
    expect(urgent.items).toHaveLength(1);
    expect(urgent.items[0]!.severity).toBe("critical");
    expect(urgent.items[0]!.href).toContain("/admin/accounts/org-1");
  });

  it("escalates an automation that is failing for more than one account", () => {
    const one = buildPlatformRecap(
      facts({ failingAgents: [{ agent: "scoring-engine", errors: 4, orgs: 1, sample: null }] }),
      ctx
    );
    const many = buildPlatformRecap(
      facts({ failingAgents: [{ agent: "scoring-engine", errors: 9, orgs: 3, sample: null }] }),
      ctx
    );
    expect(one.sections.find((s) => s.key === "urgent")!.items[0]!.severity).toBe("warning");
    expect(many.sections.find((s) => s.key === "urgent")!.items[0]!.severity).toBe("critical");
  });

  it("names an account that has gone quiet, without calling it urgent", () => {
    const recap = buildPlatformRecap(
      facts({
        quietAccounts: [
          { orgId: "org-2", orgName: "Sleepy Co", days: 21, lastActivity: "2026-08-08" },
        ],
      }),
      ctx
    );
    expect(recap.urgentCount).toBe(0);
    const review = recap.sections.find((s) => s.key === "review")!;
    expect(review.items[0]!.title).toContain("Sleepy Co");
  });

  it("is quiet only when nothing ran and nothing is wrong", () => {
    expect(buildPlatformRecap(facts(), ctx).quiet).toBe(true);
    expect(buildPlatformRecap(facts({ jobRuns: 300 }), ctx).quiet).toBe(false);
  });

  it("renders through the same email as an account recap, addressed to the platform", () => {
    const recap = buildPlatformRecap(facts({ accounts: 12, activeAccounts: 5, jobRuns: 800 }), ctx);
    const out = renderRecapEmail(recap, { appUrl: "https://app.example.com" });
    expect(out.subject.startsWith("Platform:")).toBe(true);
    expect(out.html).toContain("Key activity totals");
  });
});
