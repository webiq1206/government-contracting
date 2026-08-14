/**
 * A granted discount must never become a code somebody can type in.
 *
 * This started as a Stripe promotion code, which was wrong in a way that only
 * shows up on an invoice. A promotion code is a bearer token: the string is
 * displayed to the admin who granted it, ordinary checkout sessions show
 * Stripe's code box, and a code allowing a single redemption means a stranger
 * who came by the string does not merely get a discount they were never
 * offered, they also consume the one the invited customer was promised.
 *
 * Coupons cannot be redeemed by customers at all. They are attached
 * server-side, by us, to a subscription or a checkout session for an account
 * we have already identified. These tests exist to stop the promotion code
 * coming back.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const coupons = { create: vi.fn(), del: vi.fn() };
const promotionCodes = { create: vi.fn(), update: vi.fn() };
const subscriptions = { update: vi.fn() };

vi.mock("../lib/billing/stripe", () => ({
  getStripe: () => ({ coupons, promotionCodes, subscriptions }),
}));

const {
  createConcessionCode,
  applyDiscountToSubscription,
  deleteConcessionCoupon,
} = await import("../lib/billing/concessions");

describe("a granted discount is a coupon, not a code", () => {
  beforeEach(() => {
    coupons.create.mockReset().mockResolvedValue({ id: "coupon_abc" });
    coupons.del.mockReset().mockResolvedValue({ deleted: true });
    promotionCodes.create.mockReset();
    promotionCodes.update.mockReset();
    subscriptions.update.mockReset().mockResolvedValue({});
  });

  it("creates no promotion code, so there is no string anyone can redeem", async () => {
    const res = await createConcessionCode({
      concession: { kind: "percent", percent: 25, months: 6 },
      idempotencyKey: "invite:someone@example.test:BROST-K4M9",
      code: "BROST-K4M9",
      label: "Invitation for someone@example.test: 25% off for the first 6 months.",
    });

    expect(res.ok).toBe(true);
    expect(promotionCodes.create).not.toHaveBeenCalled();
    expect(coupons.create).toHaveBeenCalledTimes(1);
    if (res.ok) {
      expect(res.value.couponId).toBe("coupon_abc");
      // The reference we hand back is our own, not something Stripe issued.
      expect(res.value.code).toBe("BROST-K4M9");
    }
  });

  it("sends free months to Stripe as 100% off, repeating for that many months", async () => {
    await createConcessionCode({
      concession: { kind: "free_months", months: 3 },
      idempotencyKey: "org:1:BROST-AAAA",
      code: "BROST-AAAA",
      label: "Acme: First 3 months free, then the normal price.",
    });

    expect(coupons.create).toHaveBeenCalledWith(
      expect.objectContaining({
        percent_off: 100,
        duration: "repeating",
        duration_in_months: 3,
        max_redemptions: 1,
      }),
      expect.objectContaining({ idempotencyKey: "org:1:BROST-AAAA:coupon" })
    );
  });

  it("leaves an open-ended discount running for the life of the subscription", async () => {
    await createConcessionCode({
      concession: { kind: "percent", percent: 15, months: null },
      idempotencyKey: "org:2:BROST-BBBB",
      code: "BROST-BBBB",
      label: "Acme: 15% off for as long as the subscription runs.",
    });

    expect(coupons.create).toHaveBeenCalledWith(
      expect.objectContaining({ percent_off: 15, duration: "forever" }),
      expect.anything()
    );
    expect(coupons.create.mock.calls[0][0]).not.toHaveProperty("duration_in_months");
  });

  it("attaches the coupon to a running subscription by id, not by code", async () => {
    const res = await applyDiscountToSubscription({
      subscriptionId: "sub_1",
      couponId: "coupon_abc",
    });

    expect(res.ok).toBe(true);
    expect(subscriptions.update).toHaveBeenCalledWith("sub_1", {
      discounts: [{ coupon: "coupon_abc" }],
    });
  });

  it("deletes the coupon behind a withdrawn invitation instead of deactivating a code", async () => {
    const res = await deleteConcessionCoupon("coupon_abc");
    expect(res.ok).toBe(true);
    expect(coupons.del).toHaveBeenCalledWith("coupon_abc");
    expect(promotionCodes.update).not.toHaveBeenCalled();
  });

  it("reports Stripe refusing rather than pretending the discount exists", async () => {
    coupons.create.mockRejectedValueOnce(new Error("No such price"));
    const res = await createConcessionCode({
      concession: { kind: "percent", percent: 10 },
      idempotencyKey: "org:3:BROST-CCCC",
      code: "BROST-CCCC",
      label: "Acme: 10% off",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("No such price");
  });
});
