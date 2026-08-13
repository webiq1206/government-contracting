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
import { subscriptionAllowsAccess } from "@/lib/organizations";
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

describe("the string-only gate", () => {
  /**
   * subscriptionAllowsAccess cannot see a date, so it must stay the permissive
   * of the two gates. Pinning that keeps someone from later "fixing" it into
   * something that disagrees with accessLevel in the strict direction.
   */
  it("admits a trial status, leaving expiry to the date-aware gate", () => {
    expect(subscriptionAllowsAccess("trial")).toBe(true);
    expect(subscriptionAllowsAccess("active")).toBe(true);
    expect(subscriptionAllowsAccess("trialing")).toBe(true);
  });

  it("refuses a closed trial and every failed state", () => {
    expect(subscriptionAllowsAccess(TRIAL_EXPIRED_STATUS)).toBe(false);
    expect(subscriptionAllowsAccess("past_due")).toBe(false);
    expect(subscriptionAllowsAccess("none")).toBe(false);
    expect(subscriptionAllowsAccess(null)).toBe(false);
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
