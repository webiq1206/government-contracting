import { describe, it, expect, afterEach } from "vitest";
import { summarise, type AdminBillingRow } from "@/lib/billing/admin";
import { isPlatformAdmin } from "@/lib/platform-admin";

const row = (over: Partial<AdminBillingRow> = {}): AdminBillingRow =>
  ({
    org_id: "o1",
    org_name: "Acme",
    owner_email: "a@acme.com",
    plan_key: "standard",
    billing_interval: "month",
    subscription_status: "active",
    amount_cents: 299700,
    price_locked: false,
    cancel_at_period_end: false,
    trial_ends_at: null,
    current_period_end: null,
    discount_code: null,
    discount_percent_off: null,
    discount_amount_off_cents: null,
    discount_ends_at: null,
    last_payment_status: null,
    last_payment_at: null,
    last_payment_error: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  }) as AdminBillingRow;

describe("MRR counts only money actually being collected", () => {
  it("excludes trials, which are not revenue", () => {
    const s = summarise([row(), row({ subscription_status: "trialing" })]);
    expect(s.mrrCents).toBe(299700);
    expect(s.trialing).toBe(1);
    expect(s.active).toBe(1);
  });

  it("excludes past due and canceled accounts", () => {
    const s = summarise([
      row({ subscription_status: "past_due" }),
      row({ subscription_status: "canceled" }),
    ]);
    expect(s.mrrCents).toBe(0);
    expect(s.pastDue).toBe(1);
    expect(s.canceled).toBe(1);
  });

  it("normalises an annual plan to a monthly figure", () => {
    // 7x monthly billed yearly must not read as 7x the monthly revenue.
    const s = summarise([row({ billing_interval: "year", amount_cents: 2097900 })]);
    expect(s.mrrCents).toBe(Math.round(2097900 / 12));
  });

  it("counts unpaid alongside past due as a payment problem", () => {
    expect(summarise([row({ subscription_status: "unpaid" })]).pastDue).toBe(1);
  });
});

describe("platform admin allowlist", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("admits only listed emails, case-insensitively", () => {
    process.env.PLATFORM_ADMIN_EMAILS = "Owner@Brostco.com, ops@brostco.com";
    expect(isPlatformAdmin("owner@brostco.com")).toBe(true);
    expect(isPlatformAdmin("OPS@BROSTCO.COM")).toBe(true);
    expect(isPlatformAdmin("someone@else.com")).toBe(false);
  });

  it("admits nobody when the list is empty", () => {
    delete process.env.PLATFORM_ADMIN_EMAILS;
    delete process.env.OPERATOR_EMAIL;
    expect(isPlatformAdmin("owner@brostco.com")).toBe(false);
    expect(isPlatformAdmin(null)).toBe(false);
    expect(isPlatformAdmin("")).toBe(false);
  });

  it("always admits the deployment operator, so a fresh install has a way in", () => {
    delete process.env.PLATFORM_ADMIN_EMAILS;
    process.env.OPERATOR_EMAIL = "ops@brostco.com";
    expect(isPlatformAdmin("ops@brostco.com")).toBe(true);
  });
});
