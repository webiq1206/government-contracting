import { describe, it, expect } from "vitest";
import {
  FOUNDING_MONTHLY_USD,
  STANDARD_MONTHLY_USD,
  TRIAL_DAYS,
  annualSavingsUsd,
} from "../lib/billing/prices";
import { isPromoActive, type PromoWindow } from "../lib/billing/promo";

describe("SaaS pricing constants", () => {
  it("uses $1997 standard and $497 founding with a 7-day trial", () => {
    expect(STANDARD_MONTHLY_USD).toBe(1997);
    expect(FOUNDING_MONTHLY_USD).toBe(497);
    expect(TRIAL_DAYS).toBe(7);
    expect(annualSavingsUsd()).toBe((1997 - 497) * 12);
  });

  /**
   * Annual is derived from monthly rather than stored, so a repricing cannot
   * leave the two disagreeing. Pinned because the derivation is the thing that
   * makes a price change safe to do in one line.
   */
  it("derives annual as seven months of the monthly rate", async () => {
    const { allPrices, ANNUAL_MONTHS_CHARGED } = await import("../lib/billing/catalog");
    expect(ANNUAL_MONTHS_CHARGED).toBe(7);
    const standardYear = allPrices().find(
      (p) => p.plan === "standard" && p.interval === "year"
    )!;
    expect(standardYear.amountCents).toBe(1997 * 7 * 100);
  });
});

describe("promo window", () => {
  it("is active only while remainingMs > 0", () => {
    const active: PromoWindow = {
      active: true,
      startedAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 60_000).toISOString(),
      durationDays: 5,
      remainingMs: 60_000,
    };
    const expired: PromoWindow = { ...active, active: false, remainingMs: 0 };
    expect(isPromoActive(active)).toBe(true);
    expect(isPromoActive(expired)).toBe(false);
  });
});
