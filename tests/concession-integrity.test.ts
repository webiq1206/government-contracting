import { describe, it, expect } from "vitest";
import {
  nudgeDecision,
  repairAction,
  discountVerdict,
  MAX_NUDGES,
  type InvitationSnapshot,
  type OrgSnapshot,
  type StripeDiscountState,
} from "@/lib/domain/concession-integrity";

const NOW = new Date("2026-08-17T00:00:00Z");
const inDays = (n: number) =>
  new Date(NOW.getTime() + n * 86_400_000).toISOString();

function inv(over: Partial<InvitationSnapshot> = {}): InvitationSnapshot {
  return {
    id: "i1",
    email: "buyer@example.com",
    concession_kind: "percent",
    expires_at: inDays(2),
    accepted_at: null,
    revoked_at: null,
    terms_applied_at: null,
    accepted_org_id: null,
    sent_count: 1,
    ...over,
  };
}

function org(over: Partial<OrgSnapshot> = {}): OrgSnapshot {
  return {
    id: "o1",
    stripe_subscription_id: null,
    billing_exempt: false,
    discount_percent_off: null,
    discount_ends_at: null,
    pending_coupon_id: "coupon_abc",
    ...over,
  };
}

function stripeState(over: Partial<StripeDiscountState> = {}): StripeDiscountState {
  return {
    subscriptionCouponId: null,
    subscriptionPercentOff: null,
    invoiceDiscountCents: null,
    ...over,
  };
}

describe("nudging an invitation before the link dies", () => {
  it("nudges inside the window", () => {
    expect(nudgeDecision(inv(), NOW)).toEqual({ nudge: true, daysLeft: 2 });
  });

  it("waits while there is still plenty of time", () => {
    const d = nudgeDecision(inv({ expires_at: inDays(9) }), NOW);
    expect(d.nudge).toBe(false);
    expect(d).toMatchObject({ reason: expect.stringContaining("too early") });
  });

  it("never nudges an accepted, withdrawn, or already-expired invitation", () => {
    expect(nudgeDecision(inv({ accepted_at: inDays(-1) }), NOW).nudge).toBe(false);
    expect(nudgeDecision(inv({ revoked_at: inDays(-1) }), NOW).nudge).toBe(false);
    expect(nudgeDecision(inv({ expires_at: inDays(-1) }), NOW).nudge).toBe(false);
  });

  it("reminds once and then lets it lapse, because re-sending resets the expiry", () => {
    expect(nudgeDecision(inv({ sent_count: MAX_NUDGES }), NOW).nudge).toBe(true);
    const second = nudgeDecision(inv({ sent_count: MAX_NUDGES + 1 }), NOW);
    expect(second.nudge).toBe(false);
    expect(second).toMatchObject({ reason: "already reminded once" });
  });

  it("does not act on an unparseable expiry", () => {
    expect(nudgeDecision(inv({ expires_at: "not a date" }), NOW).nudge).toBe(false);
  });
});

describe("repairing terms that never landed", () => {
  const accepted = { accepted_at: inDays(-1), accepted_org_id: "o1" };

  it("does nothing when the terms already landed", () => {
    expect(
      repairAction(inv({ ...accepted, terms_applied_at: inDays(-1) }), org())
    ).toEqual({ action: "none", reason: "terms already applied" });
  });

  it("writes the pending terms for an account that has not subscribed yet", () => {
    expect(repairAction(inv(accepted), org())).toEqual({
      action: "apply_pending_terms",
    });
  });

  it("sets the free-account flag, and not twice", () => {
    expect(
      repairAction(inv({ ...accepted, concession_kind: "free_account" }), org())
    ).toEqual({ action: "apply_free_account" });
    expect(
      repairAction(
        inv({ ...accepted, concession_kind: "free_account" }),
        org({ billing_exempt: true })
      )
    ).toEqual({ action: "none", reason: "already a free account" });
  });

  it("attaches the coupon when they have since started paying with no discount", () => {
    expect(
      repairAction(inv(accepted), org({ stripe_subscription_id: "sub_1" }))
    ).toEqual({ action: "attach_coupon_to_subscription" });
  });

  it("refuses to stack a second discount and asks for a human", () => {
    const r = repairAction(
      inv(accepted),
      org({ stripe_subscription_id: "sub_1", discount_percent_off: 20 })
    );
    expect(r).toMatchObject({ action: "needs_human" });
    expect(r).toMatchObject({ reason: expect.stringContaining("stack") });
  });

  it("asks for a human when the account cannot be found at all", () => {
    expect(
      repairAction(inv({ accepted_at: inDays(-1), accepted_org_id: null }), null)
    ).toMatchObject({ action: "needs_human" });
  });

  it("leaves a plain invitation alone once it is paying on its own terms", () => {
    expect(
      repairAction(
        inv({ ...accepted, concession_kind: "none" }),
        org({ stripe_subscription_id: "sub_1" })
      )
    ).toEqual({ action: "none", reason: "already subscribed on its own terms" });
  });
});

describe("confirming the discount reached Stripe and the invoice", () => {
  it("accepts a promise still waiting for checkout", () => {
    expect(discountVerdict(org(), stripeState()).ok).toBe(true);
  });

  it("catches a granted discount that never reached the subscription", () => {
    const v = discountVerdict(
      org({ stripe_subscription_id: "sub_1" }),
      stripeState()
    );
    expect(v.ok).toBe(false);
    expect(v).toMatchObject({ severity: "error" });
    expect(v).toMatchObject({ problem: expect.stringContaining("full price") });
  });

  it("catches our records claiming a discount Stripe does not have", () => {
    const v = discountVerdict(
      org({
        stripe_subscription_id: "sub_1",
        pending_coupon_id: null,
        discount_percent_off: 25,
      }),
      stripeState()
    );
    expect(v).toMatchObject({ ok: false, severity: "error" });
  });

  it("flags a discount Stripe applies that we cannot explain", () => {
    const v = discountVerdict(
      org({ stripe_subscription_id: "sub_1", pending_coupon_id: null }),
      stripeState({ subscriptionCouponId: "coupon_x", invoiceDiscountCents: 500 })
    );
    // The customer is charged correctly, so this is not an emergency.
    expect(v).toMatchObject({ ok: false, severity: "warn" });
  });

  it("catches a percentage that does not match what we recorded", () => {
    const v = discountVerdict(
      org({ stripe_subscription_id: "sub_1", discount_percent_off: 25 }),
      stripeState({
        subscriptionCouponId: "coupon_abc",
        subscriptionPercentOff: 10,
        invoiceDiscountCents: 900,
      })
    );
    expect(v).toMatchObject({ ok: false, severity: "error" });
    expect(v).toMatchObject({ problem: expect.stringContaining("10% where") });
  });

  it("catches a coupon attached that is not reaching the bill", () => {
    const v = discountVerdict(
      org({ stripe_subscription_id: "sub_1", discount_percent_off: 25 }),
      stripeState({
        subscriptionCouponId: "coupon_abc",
        subscriptionPercentOff: 25,
        invoiceDiscountCents: 0,
      })
    );
    expect(v).toMatchObject({ ok: false, severity: "error" });
    expect(v).toMatchObject({ problem: expect.stringContaining("no discount at all") });
  });

  it("passes when the coupon is attached and the invoice shows it", () => {
    const v = discountVerdict(
      org({ stripe_subscription_id: "sub_1", discount_percent_off: 25 }),
      stripeState({
        subscriptionCouponId: "coupon_abc",
        subscriptionPercentOff: 25,
        invoiceDiscountCents: 2500,
      })
    );
    expect(v.ok).toBe(true);
  });

  it("does not fail an account whose first invoice has not been issued", () => {
    const v = discountVerdict(
      org({ stripe_subscription_id: "sub_1", discount_percent_off: 25 }),
      stripeState({
        subscriptionCouponId: "coupon_abc",
        subscriptionPercentOff: 25,
        invoiceDiscountCents: null,
      })
    );
    expect(v.ok).toBe(true);
  });
});
