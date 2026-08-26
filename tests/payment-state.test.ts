import { describe, it, expect } from "vitest";
import { paymentState } from "@/lib/domain/payment-state";

const NOW = new Date("2026-08-26T12:00:00Z");

describe("paymentState", () => {
  it("says a comped account has nothing to pay and offers it nothing to press", () => {
    const v = paymentState({ billingExempt: true, subscriptionStatus: "canceled", now: NOW });
    expect(v.state).toBe("no_billing");
    expect(v.headline).toBe("Full access, no billing required");
    expect(v.actionHref).toBeNull();
    expect(v.urgent).toBe(false);
  });

  it("puts the comped reading ahead of a Stripe status that contradicts it", () => {
    // A comped account's Stripe status is routinely 'canceled', which is true
    // and reads as broken on the one page an owner checks when worried.
    const v = paymentState({
      billingExempt: true,
      subscriptionStatus: "past_due",
      lastPaymentStatus: "failed",
      now: NOW,
    });
    expect(v.state).toBe("no_billing");
    expect(v.urgent).toBe(false);
  });

  it("names the retry date when there is one", () => {
    const v = paymentState({
      subscriptionStatus: "past_due",
      lastPaymentStatus: "failed",
      lastPaymentError: "Your card was declined.",
      nextPaymentAttemptAt: "2026-08-29T09:00:00Z",
      invoiceUrl: "https://invoice.test/abc",
      now: NOW,
    });
    expect(v.state).toBe("failed_retrying");
    expect(v.urgent).toBe(true);
    expect(v.next).toContain("August 29");
    expect(v.reason).toBe("Your card was declined.");
    expect(v.actionHref).toBe("https://invoice.test/abc");
    expect(v.actionLabel).toBe("Pay this invoice");
  });

  it("never promises a retry it has no date for", () => {
    const v = paymentState({
      subscriptionStatus: "past_due",
      lastPaymentStatus: "failed",
      now: NOW,
    });
    expect(v.state).toBe("failed_final");
    expect(v.next).toContain("No further attempt is scheduled");
    expect(v.next).not.toMatch(/try again|tried again/i);
  });

  it("treats a retry date already in the past as no retry at all", () => {
    // A stale date is worse than none: it tells somebody to wait for a
    // moment that has already gone by.
    const v = paymentState({
      subscriptionStatus: "past_due",
      lastPaymentStatus: "failed",
      nextPaymentAttemptAt: "2026-08-20T09:00:00Z",
      now: NOW,
    });
    expect(v.state).toBe("failed_final");
  });

  it("ignores an unparseable retry date rather than rendering it", () => {
    const v = paymentState({
      subscriptionStatus: "past_due",
      lastPaymentStatus: "failed",
      nextPaymentAttemptAt: "next tuesday",
      now: NOW,
    });
    expect(v.state).toBe("failed_final");
    expect(v.next).not.toContain("Invalid");
  });

  it("says what an unpaid invoice costs, and that nothing is deleted", () => {
    const v = paymentState({ subscriptionStatus: "unpaid", now: NOW });
    expect(v.headline).toContain("gone unpaid");
    expect(v.consequence).toContain("Nothing is deleted");
  });

  it("separates a bank confirmation from a decline, because a retry will not fix it", () => {
    const v = paymentState({
      subscriptionStatus: "past_due",
      lastPaymentStatus: "action_required",
      invoiceUrl: "https://invoice.test/xyz",
      now: NOW,
    });
    expect(v.state).toBe("action_required");
    expect(v.next).toContain("Retrying the card on its own will not clear this");
    expect(v.actionLabel).toBe("Confirm the payment");
  });

  it("falls back to the portal when there is no invoice link", () => {
    const v = paymentState({
      subscriptionStatus: "past_due",
      lastPaymentStatus: "failed",
      now: NOW,
    });
    expect(v.actionHref).toBe("/api/billing/portal");
    expect(v.actionLabel).toBe("Update the card");
  });

  it("reports a subscription set to cancel without calling it a failure", () => {
    const v = paymentState({
      subscriptionStatus: "active",
      cancelAtPeriodEnd: true,
      currentPeriodEnd: "2026-09-15T00:00:00Z",
      now: NOW,
    });
    expect(v.state).toBe("canceling");
    expect(v.urgent).toBe(false);
    expect(v.headline).toContain("September 15");
  });

  it("reports a healthy subscription with its next charge date", () => {
    const v = paymentState({
      subscriptionStatus: "active",
      currentPeriodEnd: "2026-09-15T00:00:00Z",
      lastPaymentAt: "2026-08-15T00:00:00Z",
      now: NOW,
    });
    expect(v.state).toBe("fine");
    expect(v.next).toContain("September 15");
    expect(v.consequence).toBeNull();
  });

  it("does not invent a charge date it does not have", () => {
    const v = paymentState({ subscriptionStatus: "active", now: NOW });
    expect(v.next).toContain("not on file yet");
  });

  it("says an account with no subscription has none, rather than reporting a fault", () => {
    const v = paymentState({ subscriptionStatus: "none", now: NOW });
    expect(v.state).toBe("no_billing");
    expect(v.urgent).toBe(false);
    expect(v.headline).toContain("No subscription");
  });

  it("treats an empty reason string as no reason", () => {
    const v = paymentState({
      subscriptionStatus: "past_due",
      lastPaymentStatus: "failed",
      lastPaymentError: "   ",
      now: NOW,
    });
    expect(v.reason).toBeNull();
  });
});
