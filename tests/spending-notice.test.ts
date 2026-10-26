import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  accountDailyRequestBlock,
  blockMessageForFacts,
  noticeForBudgetMessage,
  noticeForFacts,
  spendingHoldCopy,
  type SpendingFacts,
} from "@/lib/domain/spending-notice";
import { decideReply } from "@/lib/domain/reply-outcome";
import type { ExtractedReply } from "@/lib/ai/reply-extract";

const OPEN: SpendingFacts = {
  dayRequests: 10,
  dailyRequestLimit: 5000,
  paused: false,
  daySpend: 4,
  dailyDollarLimit: 25,
  monthSpend: 188,
  monthlyDollarLimit: 1000,
  unknownCosts: 0,
  platformDayRequests: 10,
  platformDailyLimit: 5000,
  usesPlatformKey: true,
};

function facts(over: Partial<SpendingFacts> = {}): SpendingFacts {
  return { ...OPEN, ...over };
}

describe("paid AI limit notices", () => {
  it("names a full daily request counter and does not blame the monthly budget", () => {
    const notice = noticeForFacts(facts({
      dayRequests: 1000,
      dailyRequestLimit: 1000,
      unknownCosts: 7,
      platformDayRequests: 1000,
      platformDailyLimit: 1000,
    }));
    expect(notice?.kind).toBe("account_daily_requests");
    expect(notice?.detail).toContain("1000 of 1000 paid requests used today");
    expect(notice?.detail).toContain("0 remaining, ceiling 1000");
    expect(notice?.detail).toContain("midnight UTC");
    expect(notice?.detail).toContain("Settings, API Usage");
    expect(notice?.detail).toContain("Raising the monthly budget does not clear a daily request limit");
    expect(notice?.detail).toContain("188.00 of $1000.00");
    expect(notice?.detail).not.toContain("pattern-matched");
    expect(notice?.detail).not.toMatch(/—|straightforward/);
    expect(notice?.actionHref).toBe("/settings/api-usage");
  });

  it("names the monthly budget without calling it a daily request cap", () => {
    const notice = noticeForFacts(facts({
      dayRequests: 12,
      dailyRequestLimit: 5000,
      monthSpend: 1000,
      monthlyDollarLimit: 1000,
    }));
    expect(notice?.kind).toBe("monthly_dollars");
    expect(notice?.detail).toContain("1000.00 of $1000.00");
    expect(notice?.detail).toContain("0.00 remaining, ceiling $1000.00");
    expect(notice?.detail).toContain("first day of next month");
    expect(notice?.detail).toContain("Changing the daily request limit does not raise the monthly budget");
    expect(notice?.detail).not.toContain("reached its daily request limit");
  });

  it("names a pause separately from either ceiling", () => {
    const notice = noticeForFacts(facts({ paused: true, dayRequests: 40 }));
    expect(notice?.kind).toBe("paused");
    expect(notice?.detail).toContain("API use is paused");
    expect(notice?.detail).toContain("40 of 5000");
    expect(notice?.detail).toContain("separate from the daily request limit and the monthly budget");
  });

  it("parses the production daily-request sentence, including the ceiling", () => {
    const message = accountDailyRequestBlock(1000);
    const notice = noticeForBudgetMessage(message);
    expect(notice?.kind).toBe("account_daily_requests");
    expect(notice?.detail).toContain("1000 of 1000 paid requests used today");
    expect(notice?.detail).toContain("0 remaining, ceiling 1000");
    const again = spendingHoldCopy(spendingHoldCopy(message));
    expect(again).toContain("daily request limit");
    expect(again).not.toContain("pattern-matched");
    expect(again).toBe(spendingHoldCopy(message));
  });

  it("keeps a daily dollar hold distinct from the request counter", () => {
    const message = "API_BUDGET: Your daily allowance cannot cover another request: $24.10 is spent or reserved against a $25.00 limit.";
    const notice = noticeForBudgetMessage(message);
    expect(notice?.kind).toBe("daily_dollars");
    expect(notice?.detail).toContain("24.10 of $25.00");
    expect(notice?.detail).toContain("separate from the daily request count");
  });

  it("turns a budget failure into a review reason instead of a pattern match", () => {
    const extracted = {
      intent: "other",
      isQuote: false,
      quoteAmount: null,
      paymentTerms: null,
      notes: null,
      companyName: null,
      canPerform: null,
      capabilityNotes: null,
      tradesMentioned: [],
      scopeSummary: null,
      laborCost: null,
      materialCost: null,
      exclusions: [],
      qualifications: [],
      leadTimeDays: null,
      availabilityNotes: null,
      quoteValidUntil: null,
      priceIsFirm: null,
      taxesIncluded: null,
      alternates: [],
      earliestStart: null,
      coversFullScope: null,
      uncoveredScope: null,
      referredTo: null,
      missingFields: [],
      conflicts: [],
      confidence: 0,
      method: "regex",
      aiExtractStatus: "budget_blocked",
      aiExtractError: accountDailyRequestBlock(1000),
    } as ExtractedReply;
    const decision = decideReply(extracted);
    expect(decision.act).toBe(false);
    expect(decision.needsReview).toBe(true);
    expect(decision.reviewReason).toContain("1000 of 1000");
    expect(decision.reviewReason).toContain("Settings, API Usage");
    expect(decision.reviewReason).not.toContain("pattern-matched");
    expect(blockMessageForFacts(facts({ dayRequests: 1000, dailyRequestLimit: 1000 }))).toContain("request limit of 1000");
  });
});

describe("hang and ceiling guardrails", () => {
  it("refuses a spent request cap before taking the admission lock", () => {
    const ledger = readFileSync("lib/api-usage/ledger.ts", "utf8");
    const precheck = ledger.indexOf("requestCapBlockMessage");
    const locked = ledger.indexOf("await transaction(async (client) => {");
    expect(precheck).toBeGreaterThan(-1);
    expect(locked).toBeGreaterThan(precheck);
  });

  it("does not let Today throw a missing tenant out of the page", () => {
    const today = readFileSync("app/(dash)/today/page.tsx", "utf8");
    expect(today).toContain("isMissingTenantContext");
    expect(today).toContain("TodayAccountUnknown");
  });

  it("shows the spending block on the shared shell", () => {
    const shell = readFileSync("components/dashboard-shell.tsx", "utf8");
    expect(shell).toContain("SpendingBlockBanner");
    expect(shell).toContain("Do not assume paid AI is running");
  });

  it("raises the platform request default to 5000 and the stored 1000 ceilings", () => {
    const defaults = readFileSync("lib/api-usage/defaults.ts", "utf8");
    expect(defaults).toContain("DEFAULT_PLATFORM_REQUESTS = 5000");
    expect(defaults).toContain("daily_requests: 100");
    const sql = readFileSync("db/migrations/143_daily_request_ceiling_5000.sql", "utf8");
    expect(sql).toContain("set daily_requests = 5000");
    expect(sql).toContain("where daily_requests = 1000");
    expect(sql).not.toMatch(/set monthly_limit/i);
    expect(sql).toContain("org_id is null");
  });
});
