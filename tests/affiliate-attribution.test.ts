import { describe, it, expect } from "vitest";
import {
  codeUnusableReason,
  appliesToInterval,
  effectiveTerms,
  type InfluencerCode,
} from "@/lib/affiliate/attribution";

const code = (over: Partial<InfluencerCode> = {}): InfluencerCode => ({
  id: "c1",
  influencer_id: "i1",
  code: "JANE20",
  discount_percent: "20.00",
  applies_to: "both",
  discount_months: null,
  commission_percent: null,
  commission_months: null,
  starts_at: null,
  ends_at: null,
  max_redemptions: null,
  redemption_count: 0,
  active: true,
  influencer_status: "active",
  influencer_commission_percent: "20.00",
  influencer_commission_months: null,
  ...over,
});

const NOW = new Date("2026-08-13T00:00:00Z");

describe("a code is only usable inside its own rules", () => {
  it("accepts an active, in-window code", () => {
    expect(codeUnusableReason(code(), NOW)).toBeNull();
  });

  it("rejects a code before it starts and after it ends", () => {
    expect(codeUnusableReason(code({ starts_at: "2026-09-01T00:00:00Z" }), NOW)).toContain(
      "not active yet"
    );
    expect(codeUnusableReason(code({ ends_at: "2026-08-01T00:00:00Z" }), NOW)).toContain(
      "expired"
    );
  });

  it("rejects a code at its redemption limit", () => {
    expect(
      codeUnusableReason(code({ max_redemptions: 50, redemption_count: 50 }), NOW)
    ).toContain("limit");
    expect(
      codeUnusableReason(code({ max_redemptions: 50, redemption_count: 49 }), NOW)
    ).toBeNull();
  });

  it("rejects a deactivated code", () => {
    expect(codeUnusableReason(code({ active: false }), NOW)).toContain("no longer active");
  });

  it("stops a paused or terminated influencer taking new referrals", () => {
    // Paused keeps existing referrals earning but recruits nobody new.
    expect(codeUnusableReason(code({ influencer_status: "paused" }), NOW)).not.toBeNull();
    expect(codeUnusableReason(code({ influencer_status: "terminated" }), NOW)).not.toBeNull();
  });
});

describe("interval eligibility", () => {
  it("honours a monthly-only or annual-only code", () => {
    expect(appliesToInterval(code({ applies_to: "month" }), "month")).toBe(true);
    expect(appliesToInterval(code({ applies_to: "month" }), "year")).toBe(false);
    expect(appliesToInterval(code({ applies_to: "year" }), "month")).toBe(false);
  });

  it("allows both when the code says both", () => {
    expect(appliesToInterval(code(), "month")).toBe(true);
    expect(appliesToInterval(code(), "year")).toBe(true);
  });
});

describe("commission terms resolve per code, then per influencer", () => {
  it("uses the influencer default when the code sets none", () => {
    expect(effectiveTerms(code({ influencer_commission_percent: "25.00" }))).toEqual({
      percent: 25,
      months: null,
    });
  });

  it("lets the code override the influencer rate and duration", () => {
    const t = effectiveTerms(
      code({
        commission_percent: "30.00",
        commission_months: 12,
        influencer_commission_percent: "20.00",
        influencer_commission_months: 6,
      })
    );
    expect(t).toEqual({ percent: 30, months: 12 });
  });

  it("treats a null duration as lifetime", () => {
    expect(effectiveTerms(code()).months).toBeNull();
  });
});
