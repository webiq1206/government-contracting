/**
 * The terms themselves, before any of them reach Stripe.
 *
 * These are pure: no database, no network. What is being pinned down is the
 * arithmetic and the wording, because both are read by customers. A discount
 * described wrongly is worse than one applied wrongly: the customer agrees to
 * something we then do not do.
 */
import { describe, it, expect } from "vitest";
import {
  describeConcession,
  generateConcessionCode,
  needsStripeCode,
  validateConcession,
} from "../lib/billing/concessions";

describe("describing what somebody is getting", () => {
  it("says free months in months, not as a percentage", () => {
    // Free months ARE a 100% coupon underneath. If that implementation detail
    // leaks into the wording, the customer reads "100% off for 3 months" and
    // has to work out that it means the same thing.
    expect(describeConcession({ kind: "free_months", months: 3 })).toBe(
      "First 3 months free, then the normal price."
    );
  });

  it("uses the singular for one month", () => {
    expect(describeConcession({ kind: "free_months", months: 1 })).toBe(
      "First month free, then the normal price."
    );
  });

  it("distinguishes a discount that ends from one that does not", () => {
    expect(describeConcession({ kind: "percent", percent: 25, months: 6 })).toBe(
      "25% off for the first 6 months."
    );
    expect(describeConcession({ kind: "percent", percent: 25, months: null })).toBe(
      "25% off for as long as the subscription runs."
    );
  });

  it("does not describe a free account as a discount", () => {
    const text = describeConcession({ kind: "free_account" });
    expect(text).toContain("Free account");
    expect(text).not.toContain("off");
  });

  it("says standard pricing rather than nothing at all", () => {
    expect(describeConcession({ kind: "none" })).toBe("Standard pricing.");
  });
});

describe("refusing terms that cannot be honoured", () => {
  it("rejects a percentage outside 1 to 100", () => {
    expect(validateConcession({ kind: "percent", percent: 0 })).toBeTruthy();
    expect(validateConcession({ kind: "percent", percent: 101 })).toBeTruthy();
    expect(validateConcession({ kind: "percent", percent: 50 })).toBeNull();
  });

  it("rejects a fractional percentage, which Stripe would round behind our back", () => {
    expect(validateConcession({ kind: "percent", percent: 12.5 })).toBeTruthy();
  });

  it("requires a month count for free months", () => {
    expect(validateConcession({ kind: "free_months", months: null })).toBeTruthy();
    expect(validateConcession({ kind: "free_months", months: 3 })).toBeNull();
  });

  it("accepts a percentage with no month count, meaning it runs forever", () => {
    expect(validateConcession({ kind: "percent", percent: 15, months: null })).toBeNull();
  });

  it("caps a run at three years so a typo is not a permanent giveaway", () => {
    expect(validateConcession({ kind: "free_months", months: 120 })).toBeTruthy();
  });
});

describe("which terms involve Stripe at all", () => {
  it("needs a coupon for a discount and for free months", () => {
    expect(needsStripeCode("percent")).toBe(true);
    expect(needsStripeCode("free_months")).toBe(true);
  });

  it("needs nothing from Stripe for normal pricing or a free account", () => {
    // A free account is our own exemption flag. Making it a 100% forever
    // coupon would mean the account stops working whenever Stripe does.
    expect(needsStripeCode("none")).toBe(false);
    expect(needsStripeCode("free_account")).toBe(false);
  });
});

describe("the code somebody reads down the phone", () => {
  it("avoids characters that are ambiguous out loud", () => {
    // O/0, I/1, S/5 and B/8 are the pairs that get misheard. A code is for
    // saying, so it must not contain a character that needs a follow-up
    // question.
    for (let i = 0; i < 300; i++) {
      const code = generateConcessionCode();
      expect(code.startsWith("BROST-")).toBe(true);
      expect(code.slice(6)).not.toMatch(/[OI1S5B0]/);
      expect(code.slice(6)).toHaveLength(4);
    }
  });

  it("is driven by the random source it is given, so collisions are testable", () => {
    const fixed = generateConcessionCode(() => 0);
    expect(fixed).toBe(generateConcessionCode(() => 0));
  });
});
