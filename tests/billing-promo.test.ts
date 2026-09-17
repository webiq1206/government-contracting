import { describe, it, expect } from "vitest";
import {
  FOUNDING_MONTHLY_USD,
  STANDARD_MONTHLY_USD,
  TRIAL_DAYS,
  annualSavingsUsd,
} from "../lib/billing/prices";
import { isPromoActive, type PromoWindow } from "../lib/billing/promo";
import { matchesCatalogPrice } from "../lib/billing/catalog";

describe("configured purchase price", () => {
  const price = { active: true, currency: "usd", unit_amount: 49700, recurring: { interval: "month", interval_count: 1 } };
  it("accepts the advertised monthly price and refuses the previous amount", () => {
    expect(matchesCatalogPrice(price, "standard", "month")).toBe(true);
    expect(matchesCatalogPrice({ ...price, unit_amount: 199700 }, "standard", "month")).toBe(false);
    expect(matchesCatalogPrice({ ...price, active: false }, "standard", "month")).toBe(false);
    expect(matchesCatalogPrice({ ...price, currency: "eur" }, "standard", "month")).toBe(false);
    expect(matchesCatalogPrice({ ...price, recurring: { interval: "month", interval_count: 2 } }, "standard", "month")).toBe(false);
  });
  it("validates the derived annual price and interval", () => {
    expect(matchesCatalogPrice({ ...price, unit_amount: 347900, recurring: { interval: "year", interval_count: 1 } }, "standard", "year")).toBe(true);
    expect(matchesCatalogPrice(price, "standard", "year")).toBe(false);
  });
});

describe("SaaS pricing constants", () => {
  it("uses $497 standard and $497 founding with a 7-day trial", () => {
    expect(STANDARD_MONTHLY_USD).toBe(497);
    expect(FOUNDING_MONTHLY_USD).toBe(497);
    expect(TRIAL_DAYS).toBe(7);
    expect(annualSavingsUsd()).toBe((497 - 497) * 12);
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
    expect(standardYear.amountCents).toBe(497 * 7 * 100);
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
