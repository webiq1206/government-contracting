import { describe, it, expect } from "vitest";
import {
  FOUNDING_MONTHLY_USD,
  STANDARD_MONTHLY_USD,
  TRIAL_DAYS,
  annualSavingsUsd,
} from "../lib/billing/prices";
import { isPromoActive, type PromoWindow } from "../lib/billing/promo";

describe("SaaS pricing constants", () => {
  it("uses $2997 standard and $497 founding with a 7-day trial", () => {
    expect(STANDARD_MONTHLY_USD).toBe(2997);
    expect(FOUNDING_MONTHLY_USD).toBe(497);
    expect(TRIAL_DAYS).toBe(7);
    expect(annualSavingsUsd()).toBe((2997 - 497) * 12);
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
