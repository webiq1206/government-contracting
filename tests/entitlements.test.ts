import { describe, it, expect } from "vitest";
import {
  accessLevel,
  accessBlockedReason,
  isCardlessTrial,
  trialDaysLeft,
  trialEndsAt,
  trialHasEnded,
  TRIAL_STATUS,
  TRIAL_EXPIRED_STATUS,
} from "@/lib/billing/entitlements";
import { entitlementOf, hasAccess, isSuspended } from "@/lib/billing/entitlements";
import { TRIAL_DAYS } from "@/lib/billing/catalog";

const NOW = new Date("2026-08-13T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

describe("who gets in", () => {
  it("gives paid subscribers full access", () => {
    expect(accessLevel({ subscription_status: "active" }, NOW)).toBe("full");
  });

  /**
   * Stripe's own 'trialing' means a card is already on file and the charge is
   * automatic. That is a stronger commitment than our cardless trial, so it is
   * unmetered.
   */
  it("gives a Stripe trial full access, since a card is on file", () => {
    expect(accessLevel({ subscription_status: "trialing" }, NOW)).toBe("full");
  });

  it("gives a live cardless trial limited access", () => {
    expect(accessLevel({ subscription_status: TRIAL_STATUS, trial_ends_at: days(3) }, NOW)).toBe(
      "trial"
    );
  });

  /**
   * The property that matters most: expiry is judged from the DATE, not from
   * the stored status. If the hourly sweep is late or wedged, a lapsed trial
   * still loses access at the right moment.
   */
  it("locks out a lapsed trial even before the sweep rewrites its status", () => {
    expect(accessLevel({ subscription_status: TRIAL_STATUS, trial_ends_at: days(-1) }, NOW)).toBe(
      "none"
    );
  });

  it("locks out a trial the sweep has already closed", () => {
    expect(
      accessLevel({ subscription_status: TRIAL_EXPIRED_STATUS, trial_ends_at: days(-1) }, NOW)
    ).toBe("none");
  });

  it("treats a trial with no end date as ended rather than unlimited", () => {
    // A missing date is a bug. Refusing access is recoverable in a support
    // message; an accidental unlimited free account is not.
    expect(accessLevel({ subscription_status: TRIAL_STATUS, trial_ends_at: null }, NOW)).toBe(
      "none"
    );
    expect(
      accessLevel({ subscription_status: TRIAL_STATUS, trial_ends_at: "not-a-date" }, NOW)
    ).toBe("none");
  });

  it("locks out every failed or absent billing state", () => {
    for (const status of ["past_due", "unpaid", "canceled", "incomplete", "none", ""]) {
      expect(accessLevel({ subscription_status: status }, NOW)).toBe("none");
    }
  });
});

describe("counting the trial down", () => {
  it("rounds up, so a partial day still reads as a day left", () => {
    expect(trialDaysLeft({ subscription_status: TRIAL_STATUS, trial_ends_at: days(0.5) }, NOW)).toBe(1);
    expect(trialDaysLeft({ subscription_status: TRIAL_STATUS, trial_ends_at: days(3) }, NOW)).toBe(3);
  });

  it("never goes negative", () => {
    expect(trialDaysLeft({ subscription_status: TRIAL_STATUS, trial_ends_at: days(-5) }, NOW)).toBe(0);
  });

  it("starts a trial exactly the advertised number of days out", () => {
    const ends = trialEndsAt(NOW);
    expect(Math.round((ends.getTime() - NOW.getTime()) / 86_400_000)).toBe(TRIAL_DAYS);
  });

  it("agrees with the expiry check at the boundary", () => {
    expect(trialHasEnded({ subscription_status: TRIAL_STATUS, trial_ends_at: days(0.001) }, NOW)).toBe(false);
    expect(trialHasEnded({ subscription_status: TRIAL_STATUS, trial_ends_at: NOW.toISOString() }, NOW)).toBe(true);
  });
});

/**
 * The comped account.
 *
 * This is the bug that started it: the organization that runs this platform
 * reads 'canceled' in Stripe, because it has never paid itself, and every gate
 * in the application therefore locked its owner out of his own product. The
 * exemption has to beat the status, the date, and the absence of both.
 */
describe("an account that is comped", () => {
  it("gets full access even though Stripe says the subscription is cancelled", () => {
    expect(
      accessLevel({ subscription_status: "canceled", billing_exempt: true }, NOW)
    ).toBe("full");
  });

  it("gets full access with no subscription and no trial at all", () => {
    expect(accessLevel({ subscription_status: null, billing_exempt: true }, NOW)).toBe("full");
  });

  it("is not downgraded to a trial by a trial date that has passed", () => {
    expect(
      accessLevel(
        { subscription_status: TRIAL_STATUS, trial_ends_at: days(-30), billing_exempt: true },
        NOW
      )
    ).toBe("full");
  });

  it("still reads as locked out when the flag is off", () => {
    expect(
      accessLevel({ subscription_status: "canceled", billing_exempt: false }, NOW)
    ).toBe("none");
  });
});

/**
 * Suspension is the one thing that outranks the exemption. An admin who
 * suspends an account has made a deliberate decision, and a comp granted
 * months earlier must not quietly undo it.
 */
describe("an account that is suspended", () => {
  it("is locked out even when comped", () => {
    expect(
      accessLevel(
        { subscription_status: "active", billing_exempt: true, suspended_at: days(-1) },
        NOW
      )
    ).toBe("none");
  });

  it("is locked out even on a paid, live subscription", () => {
    expect(
      accessLevel({ subscription_status: "active", suspended_at: days(-1) }, NOW)
    ).toBe("none");
  });

  it("says it was suspended rather than blaming a payment", () => {
    const reason = accessBlockedReason(
      { subscription_status: "active", suspended_at: days(-1) },
      NOW
    );
    expect(reason).toMatch(/suspended/i);
    // The customer's work is still there; saying so is the difference between
    // a support email and a panic.
    expect(reason).toMatch(/nothing has been deleted/i);
  });

  it("reads as not suspended when the column is null", () => {
    expect(isSuspended({ subscription_status: "active", suspended_at: null })).toBe(false);
  });
});

/**
 * One helper, fed from the session, so a gate holding only a SessionUser
 * reaches the same answer as one holding the organization row. Two gates that
 * disagreed is how the owner ended up locked out of some screens and not
 * others.
 */
describe("reading entitlement off a session", () => {
  it("carries the exemption through from the session", () => {
    expect(
      hasAccess(
        entitlementOf({
          subscriptionStatus: "canceled",
          trialEndsAt: null,
          billingExempt: true,
          suspendedAt: null,
        }),
        NOW
      )
    ).toBe(true);
  });

  it("carries suspension through from the session", () => {
    expect(
      hasAccess(
        entitlementOf({
          subscriptionStatus: "active",
          trialEndsAt: null,
          billingExempt: true,
          suspendedAt: days(-1),
        }),
        NOW
      )
    ).toBe(false);
  });

  it("treats missing fields as the safe default rather than access", () => {
    expect(hasAccess(entitlementOf({ subscriptionStatus: TRIAL_EXPIRED_STATUS }), NOW)).toBe(
      false
    );
    expect(hasAccess(entitlementOf({ subscriptionStatus: "active" }), NOW)).toBe(true);
  });

  it("still expires a lapsed trial that is not comped", () => {
    expect(
      hasAccess(
        entitlementOf({ subscriptionStatus: TRIAL_STATUS, trialEndsAt: days(-1) }),
        NOW
      )
    ).toBe(false);
  });
});

describe("what the customer is told", () => {
  it("explains a trial ending without blaming them, and promises their data", () => {
    const msg = accessBlockedReason({ subscription_status: TRIAL_EXPIRED_STATUS }, NOW);
    expect(msg).toContain("free trial has ended");
    expect(msg.toLowerCase()).toContain("still here");
  });

  it("distinguishes a failed payment from a cancellation", () => {
    expect(accessBlockedReason({ subscription_status: "past_due" }, NOW)).toContain("card");
    expect(accessBlockedReason({ subscription_status: "canceled" }, NOW)).toContain("cancelled");
  });

  it("knows a cardless trial from a Stripe subscription", () => {
    expect(isCardlessTrial({ subscription_status: TRIAL_STATUS })).toBe(true);
    expect(isCardlessTrial({ subscription_status: TRIAL_EXPIRED_STATUS })).toBe(true);
    expect(isCardlessTrial({ subscription_status: "trialing" })).toBe(false);
    expect(isCardlessTrial({ subscription_status: "active" })).toBe(false);
  });
});
