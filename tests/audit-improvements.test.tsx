import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CONTRACTOR_GUIDES } from "@/lib/marketing/resources";
import { publicMetadata } from "@/lib/marketing/metadata";
import { publicEventPayload } from "@/lib/domain/public-analytics";
import { PUBLIC_ROUTES } from "@/lib/domain/public-routes";
import { TRIAL_LIMITS } from "@/lib/billing/trial-catalog";
import { classifyFailure, causeSpec } from "@/lib/domain/automation-health";
import { describeClaudeFailure } from "@/lib/ai/claude";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";
import { TrialAllowances } from "@/components/marketing/trial-allowances";
import { RiskFlagList } from "@/components/risk-flag-list";

describe("audit regression coverage", () => {
  it("groups duplicate risk labels while retaining their recorded count", () => {
    const html = renderToStaticMarkup(<RiskFlagList flags={["prime_only_blocked", "prime_only_blocked"]} />);
    expect(html.match(/href="#attention"/g)).toHaveLength(1);
    expect(html).toContain("2 recorded flags");
    expect(html).toContain("prime_only_blocked, prime_only_blocked");
  });
  it("discloses the actual enforced trial limits", () => {
    const html = renderToStaticMarkup(<TrialAllowances />);
    expect(html).toContain(`${TRIAL_LIMITS.ai_briefs} AI bid briefs`);
    expect(html).toContain(`${TRIAL_LIMITS.outreach_emails} subcontractor emails`);
    expect(html).toContain(`${TRIAL_LIMITS.bid_packages} bid packages`);
  });
  it("separates a dated provider allowance from key rejection and transient throttling", () => {
    const message = "Your organization has reached its specified API usage limits. You will regain access on 2026-10-01 at 00:00 UTC.";
    expect(classifyFailure(message)).toBe("provider_credit");
    const failure = describeClaudeFailure({ status: 429, message });
    expect(failure?.retryable).toBe(false);
    expect(failure?.reason).toContain("2026-10-01");
    expect(failure?.reason).not.toContain("rejected the API key");
    expect(causeSpec("provider_auth").title).not.toContain("AI key");
    expect(describeClaudeFailure({ status: 429, message: "Too many requests" })?.retryable).toBe(true);
  });
  it("uses page-specific social previews and only one brand suffix", () => {
    const meta = publicMetadata("Government bid management software", "A connected bid workflow.", "/platform");
    expect(meta.title).toBe("Government bid management software");
    expect(meta.openGraph?.title).toBe("Government bid management software | BrostCo");
    expect(meta.openGraph?.url).toBe("/platform");
    expect(meta.alternates?.canonical).toBe("/platform");
  });
  it("publishes eight distinct guides with sources and valid related links", () => {
    expect(CONTRACTOR_GUIDES).toHaveLength(8);
    const slugs = new Set(CONTRACTOR_GUIDES.map((guide) => guide.slug));
    expect(slugs.size).toBe(8);
    for (const guide of CONTRACTOR_GUIDES) {
      expect(PUBLIC_ROUTES.some((route) => route.path === `/resources/${guide.slug}`)).toBe(true);
      expect(guide.sources.length).toBeGreaterThan(0);
      expect(guide.sections.length).toBeGreaterThanOrEqual(4);
      for (const related of guide.related) expect(slugs.has(related)).toBe(true);
      expect(PUBLIC_ROUTES.some((route) => route.path === guide.productHref)).toBe(true);
    }
  });
  it("lets unknown public URLs reach a real 404 without opening private pages", () => {
    for (const path of ["/missing-public-page", "/resources/missing-guide"])
      expect(middleware(new NextRequest(`https://example.test${path}`)).headers.get("x-middleware-next")).toBe("1");
    for (const path of ["/today", "/admin/accounts", "/opportunity/abc", "/settings/profile"])
      expect(middleware(new NextRequest(`https://example.test${path}`)).headers.get("location")).toContain("/login?");
  });
  it("accepts only known public event and page identifiers, dropping sensitive extras", () => {
    expect(publicEventPayload({ event: "signup_started", path: "/signup", location: "form", email: "private@example.com", target: "/today", meta: { password: "never store" } })).toEqual({ event: "signup_started", path: "/signup", meta: { location: "form" } });
    for (const value of [{ event: "account_created", path: "/signup" }, { event: "cta_click", path: "/today" }, { event: "cta_click", path: "/signup?email=private@example.com" }]) expect(publicEventPayload(value)).toBeNull();
  });
});
