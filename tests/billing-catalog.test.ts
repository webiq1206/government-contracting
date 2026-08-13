import { describe, it, expect, afterEach } from "vitest";
import {
  PLANS,
  planPrice,
  allPrices,
  priceIdFor,
  planForPriceId,
  billingConfigured,
  isLiveMode,
  ANNUAL_MONTHS_CHARGED,
  TRIAL_DAYS,
} from "@/lib/billing/catalog";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("the catalog is the only place pricing is defined", () => {
  it("prices annual as seven months, so five are free", () => {
    expect(ANNUAL_MONTHS_CHARGED).toBe(7);
    const std = planPrice("standard", "year");
    expect(std.amountUsd).toBe(PLANS.standard.monthlyUsd * 7);
    expect(std.savingsUsd).toBe(PLANS.standard.monthlyUsd * 5);
  });

  it("derives cents from dollars so the two cannot drift", () => {
    for (const p of allPrices()) {
      expect(p.amountCents).toBe(p.amountUsd * 100);
    }
  });

  it("keeps the founding rate grandfathered and promo-gated", () => {
    expect(PLANS.founding.grandfathered).toBe(true);
    expect(PLANS.founding.promoOnly).toBe(true);
    expect(PLANS.standard.grandfathered).toBe(false);
  });

  it("gives every price a stable lookup key for idempotent setup", () => {
    const keys = allPrices().map((p) => p.lookupKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(planPrice("founding", "year").lookupKey).toBe("brostco_founding_year");
  });

  it("applies a trial to every plan", () => {
    expect(TRIAL_DAYS).toBeGreaterThan(0);
  });
});

describe("resolving Stripe price IDs", () => {
  it("accepts the original single-interval name as monthly", () => {
    process.env.STRIPE_PRICE_STANDARD = "price_legacy";
    delete process.env.STRIPE_PRICE_STANDARD_MONTHLY;
    expect(priceIdFor("standard", "month")).toBe("price_legacy");
  });

  it("prefers the explicit monthly name over the legacy one", () => {
    process.env.STRIPE_PRICE_STANDARD = "price_legacy";
    process.env.STRIPE_PRICE_STANDARD_MONTHLY = "price_new";
    expect(priceIdFor("standard", "month")).toBe("price_new");
  });

  it("maps a price ID back to its plan and interval", () => {
    process.env.STRIPE_PRICE_FOUNDING_ANNUAL = "price_fa";
    expect(planForPriceId("price_fa")).toEqual({ plan: "founding", interval: "year" });
  });

  it("reports an unknown price as no plan rather than guessing one", () => {
    // Guessing here would silently move a subscriber onto the wrong plan.
    expect(planForPriceId("price_unknown")).toEqual({ plan: "none", interval: null });
    expect(planForPriceId(null)).toEqual({ plan: "none", interval: null });
  });
});

describe("refusing to sell when billing is not wired up", () => {
  it("is not configured without a secret key", () => {
    delete process.env.STRIPE_SECRET_KEY;
    expect(billingConfigured().missing).toContain("STRIPE_SECRET_KEY");
  });

  it("is not configured without a webhook secret", () => {
    // Without this the webhook refuses events, so a paid signup never activates.
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect(billingConfigured().missing).toContain("STRIPE_WEBHOOK_SECRET");
  });

  it("is not configured without a standard monthly price", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
    delete process.env.STRIPE_PRICE_STANDARD;
    delete process.env.STRIPE_PRICE_STANDARD_MONTHLY;
    expect(billingConfigured().missing).toContain("STRIPE_PRICE_STANDARD_MONTHLY");
  });

  it("is configured once all three are present", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
    process.env.STRIPE_PRICE_STANDARD_MONTHLY = "price_x";
    expect(billingConfigured()).toEqual({ ok: true, missing: [] });
  });

  it("detects live mode from the key prefix", () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_x";
    expect(isLiveMode()).toBe(true);
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    expect(isLiveMode()).toBe(false);
  });
});
