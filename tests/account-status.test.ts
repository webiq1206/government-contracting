/**
 * Six answers that must never fight.
 *
 * The live contradiction: a comped account -- the platform owner's own
 * organization, and every account given free access -- reads `canceled` in
 * Stripe, because that is literally true and completely irrelevant. The
 * billing page printed it, in red, beside an offer to reactivate. The owner of
 * an account that worked perfectly was told it was cancelled.
 *
 * So the comped cases are tested hardest here, and every one of them asserts
 * two things: that the customer-facing lines say the arrangement, and that the
 * account is never offered something to buy.
 */
import { describe, it, expect } from "vitest";
import { accountStatus, daysLeft } from "@/lib/domain/account-status";

const NOW = new Date("2026-08-25T12:00:00Z");

describe("accountStatus, comped accounts", () => {
  const comped = accountStatus({
    subscriptionStatus: "canceled",
    billingExempt: true,
    stripeCustomerId: null,
    now: NOW,
  });

  it("reads as full access with no billing required", () => {
    expect(comped.access).toBe("full");
    expect(comped.effective.value).toBe("Full access, no billing required");
    expect(comped.billing.value).toBe("No billing required");
  });

  it("never says cancelled to the customer", () => {
    // Stripe's word survives only in the row that is explicitly Stripe's view.
    expect(comped.productAccess.value).not.toMatch(/cancel/i);
    expect(comped.billing.value).not.toMatch(/cancel/i);
    expect(comped.effective.value).not.toMatch(/cancel/i);
  });

  it("offers nothing to buy and no portal", () => {
    expect(comped.showPurchase).toBe(false);
    expect(comped.showPortal).toBe(false);
  });

  it("does not report a trial that is not running", () => {
    expect(comped.trial.value).toBe("Not applicable");
  });

  it("keeps Stripe's own view visible for support, marked as not affecting anything", () => {
    const withStripe = accountStatus({
      subscriptionStatus: "incomplete_expired",
      billingExempt: true,
      stripeCustomerId: "cus_1",
      now: NOW,
    });
    expect(withStripe.stripe.value).toBe("incomplete_expired");
    expect(withStripe.stripe.detail).toMatch(/does not affect/i);
    expect(withStripe.access).toBe("full");
  });
});

describe("accountStatus, precedence", () => {
  it("puts suspension above the exemption", () => {
    const s = accountStatus({
      subscriptionStatus: "active",
      billingExempt: true,
      suspendedAt: "2026-08-01T00:00:00Z",
      now: NOW,
    });
    expect(s.access).toBe("none");
    expect(s.effective.value).toBe("Suspended");
    expect(s.showPurchase).toBe(false);
  });

  it("keeps access while a card is being retried", () => {
    /*
     * past_due means Stripe is retrying a declined renewal, usually an expired
     * card. Cutting a deadline-driven product off here turns a card hiccup
     * into a missed federal submission.
     */
    const s = accountStatus({ subscriptionStatus: "past_due", stripeCustomerId: "cus_1", now: NOW });
    expect(s.access).toBe("full");
    expect(s.billing.value).toBe("Payment failed, retrying");
    expect(s.billing.tone).toBe("warn");
  });

  it("ends access when retries are exhausted", () => {
    const s = accountStatus({ subscriptionStatus: "unpaid", stripeCustomerId: "cus_1", now: NOW });
    expect(s.access).toBe("none");
  });
});

describe("accountStatus, the cardless trial", () => {
  it("counts down while it is live", () => {
    const s = accountStatus({
      subscriptionStatus: "trial",
      trialEndsAt: new Date(NOW.getTime() + 3 * 86_400_000),
      now: NOW,
    });
    expect(s.access).toBe("trial");
    expect(s.trial.value).toBe("3 days left");
    expect(s.billing.value).toBe("No card on file");
    expect(s.showPurchase).toBe(true);
  });

  it("warns in the last two days", () => {
    const s = accountStatus({
      subscriptionStatus: "trial",
      trialEndsAt: new Date(NOW.getTime() + 36_00_000),
      now: NOW,
    });
    expect(s.trial.tone).toBe("warn");
  });

  it("ends access the moment it lapses, without waiting for the sweep", () => {
    // The expiry sweep tidies the stored status; it must never be what decides
    // access, or a wedged sweep hands out free months.
    const s = accountStatus({
      subscriptionStatus: "trial",
      trialEndsAt: new Date(NOW.getTime() - 60_000),
      now: NOW,
    });
    expect(s.access).toBe("none");
    expect(s.trial.value).toBe("Ended");
  });

  it("does not confuse Stripe's trial with ours", () => {
    // Stripe's 'trialing' means a card is already on file, which is a stronger
    // commitment than our cardless trial and must not be metered like one.
    const s = accountStatus({ subscriptionStatus: "trialing", stripeCustomerId: "cus_1", now: NOW });
    expect(s.access).toBe("full");
    expect(s.trial.value).toMatch(/card on file/i);
  });
});

describe("accountStatus, automation entitlement", () => {
  it("separates 'allowed to run' from 'is running'", () => {
    const s = accountStatus({ subscriptionStatus: "active", stripeCustomerId: "cus_1", now: NOW });
    expect(s.automation.value).toBe("Allowed to run");
    expect(s.automation.detail).toMatch(/Automation Health/);
  });

  it("reports a deliberate pause as a choice, not a failure", () => {
    const s = accountStatus({ subscriptionStatus: "active", automationPaused: true, now: NOW });
    expect(s.automation.value).toBe("Paused by choice");
    expect(s.automation.tone).toBe("warn");
  });

  it("stops automation when access has gone", () => {
    const s = accountStatus({ subscriptionStatus: "canceled", now: NOW });
    expect(s.automation.value).toBe("Stopped");
  });
});

describe("daysLeft", () => {
  it("never goes negative", () => {
    expect(daysLeft(new Date(NOW.getTime() - 10 * 86_400_000), NOW)).toBe(0);
  });
  it("is zero when there is no date rather than guessing", () => {
    expect(daysLeft(null, NOW)).toBe(0);
  });
});
