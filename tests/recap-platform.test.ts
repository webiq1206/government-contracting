import { describe, expect, it } from "vitest";
import { buildPlatformRecap, type PlatformRecapFacts } from "@/lib/recap/platform";
import { renderRecapEmail } from "@/lib/domain/recap/email";

const NOW = new Date("2026-08-30T13:00:00Z");

function facts(over: Partial<PlatformRecapFacts> = {}): PlatformRecapFacts {
  return {
    brokenIntegrations: [],
    failingAgents: [],
    spendingHolds: [],
    mailTrouble: [],
    quietAccounts: [],
    accounts: 0,
    activeAccounts: 0,
    emailsSent: 0,
    emailsFailed: 0,
    emailsBounced: 0,
    emailsNeverSent: 0,
    jobRuns: 0,
    jobFailures: 0,
    jobsHeld: 0,
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
          { orgId: "org-1", orgName: "Northside Builders", failed: 9, bounced: 9, neverSent: 0 },
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

  it("reports work held on an API allowance as a hold, apart from failing agents", () => {
    // 701 refusals of the same analysis on one account is one setting to
    // review, not 701 broken automations.
    const recap = buildPlatformRecap(
      facts({
        spendingHolds: [
          {
            orgId: "org-1",
            orgName: "BROST CO",
            held: 701,
            agents: ["solicitation-analyst"],
            sample:
              "API_BUDGET: Your daily allowance cannot cover another request: $24.10 is spent or reserved against a $25.00 limit.",
          },
        ],
        jobRuns: 1733,
        jobFailures: 4,
        jobsHeld: 701,
      }),
      ctx
    );
    const urgent = recap.sections.find((s) => s.key === "urgent")!;
    expect(urgent.items).toHaveLength(1);
    const item = urgent.items[0]!;
    expect(item.title).toBe("BROST CO has 701 tasks waiting on its API allowance");
    expect(item.title).not.toMatch(/failed/);
    expect(item.detail).toContain("solicitation-analyst stopped before spending anything");
    expect(item.detail).toContain("$24.10 is spent or reserved");
    expect(item.detail).not.toContain("API_BUDGET:");
    expect(item.reason).toBe("Paid work is on hold");
    expect(item.href).toBe("/admin/accounts/org-1");

    const jobs = recap.sections.find((s) => s.key === "totals")!.totals.find((t) => t.label === "Jobs run")!;
    expect(jobs.value).toBe(1733);
    expect(jobs.note).toBe("4 failed, 701 waiting on an API allowance");
  });

  it("does not say a platform-owned job failed across zero accounts", () => {
    const recap = buildPlatformRecap(
      facts({
        failingAgents: [
          {
            agent: "backlink-scout",
            errors: 4,
            orgs: 0,
            sample:
              "API_BUDGET: This service needs a price ceiling before a dollar limit can protect your spending. Ask the platform administrator to set one, or use a request-count limit. New paid work has stopped to protect your budget. Open Settings, API Usage to review limits or resume work.",
          },
        ],
      }),
      ctx
    );
    const item = recap.sections.find((s) => s.key === "urgent")!.items[0]!;
    expect(item.title).toBe("backlink-scout failed 4 times for the platform");
    expect(item.title).not.toContain("0 account");
    // A platform price ceiling is set on the admin page, not a tenant's settings.
    expect(item.href).toBe("/admin/api-usage");
    // Clipped at a word, and says so, rather than ending in "or res".
    expect(item.detail!.endsWith("...")).toBe(true);
    const kept = item.detail!.slice(0, -3);
    const sample = "API_BUDGET: This service needs a price ceiling before a dollar limit can protect your spending. Ask the platform administrator to set one, or use a request-count limit. New paid work has stopped to protect your budget. Open Settings, API Usage to review limits or resume work.";
    expect(sample.startsWith(kept)).toBe(true);
    expect(sample.charAt(kept.length)).toBe(" ");
    expect(item.detail!.length).toBeLessThanOrEqual(203);
  });

  it("says whether undelivered mail bounced or never left, instead of one ambiguous count", () => {
    const bounced = buildPlatformRecap(
      facts({
        mailTrouble: [{ orgId: "org-1", orgName: "BROST CO", failed: 6, bounced: 6, neverSent: 0 }],
        emailsSent: 6,
        emailsFailed: 6,
        emailsBounced: 6,
        emailsNeverSent: 0,
      }),
      ctx
    );
    expect(bounced.sections.find((s) => s.key === "urgent")!.items[0]!.title).toBe(
      "6 emails bounced for BROST CO"
    );
    const sent = bounced.sections.find((s) => s.key === "totals")!.totals.find((t) => t.label === "Emails sent")!;
    expect(sent.note).toBe("6 bounced");

    const never = buildPlatformRecap(
      facts({
        mailTrouble: [{ orgId: "org-1", orgName: "BROST CO", failed: 10, bounced: 0, neverSent: 10 }],
        emailsSent: 0,
        emailsFailed: 10,
        emailsBounced: 0,
        emailsNeverSent: 10,
      }),
      ctx
    );
    const item = never.sections.find((s) => s.key === "urgent")!.items[0]!;
    expect(item.title).toBe("10 emails never left for BROST CO");
    expect(item.detail).toContain("never handed to a provider");
    expect(
      never.sections.find((s) => s.key === "totals")!.totals.find((t) => t.label === "Emails sent")!.note
    ).toBe("10 never left");
  });
});
