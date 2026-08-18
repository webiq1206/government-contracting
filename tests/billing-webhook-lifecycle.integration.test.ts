/**
 * Full subscription lifecycle against a REAL database.
 *
 * billing-webhook.test.ts proves signature verification and the dedupe logic
 * with a mocked DB. This drives the real webhook handler, the real events
 * module (claim / order guard / applied-stamp), and the real
 * updateOrganizationBilling against a real organizations row, so the money
 * decisions — activation, idempotent replay, out-of-order protection,
 * cancellation, and the resulting ACCESS level — are asserted on real state.
 *
 * Only Stripe's SDK (constructEvent + subscriptions.retrieve) and the outbound
 * notifications are mocked; nothing about our own state handling is.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

process.env.STRIPE_SECRET_KEY = "sk_test_x";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";

const constructEvent = vi.fn();
const retrieve = vi.fn();

vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => ({ webhooks: { constructEvent }, subscriptions: { retrieve } }),
}));
vi.mock("@/lib/billing/notify", () => ({
  notifyTrialStarted: vi.fn(), notifyTrialEnding: vi.fn(),
  notifyPaymentSucceeded: vi.fn(), notifyPaymentFailed: vi.fn(),
  notifyCanceled: vi.fn(), notifyReactivated: vi.fn(),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const CUSTOMER = `cus_${randomUUID().slice(0, 12)}`;
const SUB = `sub_${randomUUID().slice(0, 12)}`;
const PRICE = "price_standard_monthly";

function req() {
  return new Request("http://x/api/billing/webhook", {
    method: "POST",
    headers: { "stripe-signature": "sig" },
    body: "{}",
  });
}

/** A synthetic Stripe subscription object with the fields readSubscription reads. */
function sub(over: Record<string, unknown> = {}) {
  return {
    id: SUB,
    status: "active",
    customer: CUSTOMER,
    cancel_at_period_end: false,
    current_period_end: 1_800_000_000,
    trial_end: null,
    items: { data: [{ price: { id: PRICE, unit_amount: 30000, recurring: { interval: "month" } } }] },
    metadata: {},
    ...over,
  };
}

d("subscription lifecycle (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let POST: typeof import("../app/api/billing/webhook/route").POST;
  let accessLevel: typeof import("../lib/billing/entitlements").accessLevel;
  let entitlementOf: typeof import("../lib/billing/entitlements").entitlementOf;
  const org = { id: "" };

  async function orgRow() {
    return queryOne<{
      subscription_status: string; plan_key: string; discount_percent_off: string | null;
      cancel_at_period_end: boolean; billing_event_at: string | null; suspended_at: string | null;
      trial_ends_at: string | null; billing_exempt: boolean;
    }>(`select subscription_status, plan_key, discount_percent_off, cancel_at_period_end,
               billing_event_at, suspended_at, trial_ends_at, billing_exempt
          from organizations where id=$1`, [org.id]);
  }
  function access(row: Awaited<ReturnType<typeof orgRow>>) {
    return accessLevel(entitlementOf({
      subscriptionStatus: row!.subscription_status,
      trialEndsAt: row!.trial_ends_at,
      billingExempt: row!.billing_exempt,
      suspendedAt: row!.suspended_at,
    } as never));
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({ POST } = await import("../app/api/billing/webhook/route"));
    ({ accessLevel, entitlementOf } = await import("../lib/billing/entitlements"));
    const o = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status, stripe_customer_id)
       values ($1,'none',$2) returning id`,
      [`bill-${randomUUID()}`, CUSTOMER]
    );
    org.id = o!.id;
  });

  afterAll(async () => {
    if (org.id) {
      await query(`delete from stripe_events where org_id=$1`, [org.id]).catch(() => {});
      await query(`delete from stripe_events`).catch(() => {}); // our synthetic ids carry null org
      await query(`delete from organizations where id=$1`, [org.id]);
    }
    vi.restoreAllMocks();
  });

  it("checkout.session.completed activates the subscription from real Stripe state", async () => {
    retrieve.mockResolvedValue(sub({ status: "active" }));
    constructEvent.mockReturnValue({
      id: "evt_checkout", type: "checkout.session.completed", created: 1000,
      data: { object: { metadata: { org_id: org.id }, subscription: SUB, customer: CUSTOMER } },
    });
    const res = await POST(req());
    expect(res.status).toBe(200);
    const row = await orgRow();
    expect(row?.subscription_status).toBe("active");
    expect(row?.plan_key).not.toBe("none");
    expect(access(row)).toBe("full");
  });

  it("replaying the same event id is a no-op (idempotent)", async () => {
    retrieve.mockClear();
    // Same event id as before; claimEvent must skip it.
    constructEvent.mockReturnValue({
      id: "evt_checkout", type: "checkout.session.completed", created: 1000,
      data: { object: { metadata: { org_id: org.id }, subscription: SUB, customer: CUSTOMER } },
    });
    const res = await POST(req());
    expect(await res.json()).toMatchObject({ duplicate: true });
    // The handler body never ran on the replay.
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("records a discount onto the org when Stripe reports a coupon", async () => {
    constructEvent.mockReturnValue({
      id: "evt_disc", type: "customer.subscription.updated", created: 2000,
      data: { object: sub({ status: "active", discounts: [{ coupon: { id: "c1", percent_off: 25 }, end: null }] }) },
    });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(Number((await orgRow())?.discount_percent_off)).toBe(25);
  });

  it("drops an out-of-order stale event rather than rolling state back", async () => {
    // A LATE 'canceled' event with an OLDER created timestamp than the last
    // applied (2000). It must not cancel an active subscription.
    constructEvent.mockReturnValue({
      id: "evt_stale_cancel", type: "customer.subscription.updated", created: 1500,
      data: { object: sub({ status: "canceled" }) },
    });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect((await orgRow())?.subscription_status).toBe("active"); // unchanged
  });

  it("applies a genuinely newer cancellation and downgrades access to none", async () => {
    constructEvent.mockReturnValue({
      id: "evt_cancel", type: "customer.subscription.deleted", created: 3000,
      data: { object: sub({ status: "canceled" }) },
    });
    const res = await POST(req());
    expect(res.status).toBe(200);
    const row = await orgRow();
    expect(row?.subscription_status).toBe("canceled");
    expect(access(row)).toBe("none"); // API + UI access ends
  });

  it("keeps access during past_due (dunning grace), not after unpaid", async () => {
    // past_due is a grace state: access continues while Stripe retries.
    constructEvent.mockReturnValue({
      id: "evt_pastdue", type: "customer.subscription.updated", created: 4000,
      data: { object: sub({ status: "past_due" }) },
    });
    await POST(req());
    expect(access(await orgRow())).toBe("full");
    // unpaid is terminal: access ends.
    constructEvent.mockReturnValue({
      id: "evt_unpaid", type: "customer.subscription.updated", created: 5000,
      data: { object: sub({ status: "unpaid" }) },
    });
    await POST(req());
    expect(access(await orgRow())).toBe("none");
  });

  it("PROBE: a stale checkout replay must not resurrect a canceled subscription", async () => {
    // State is 'canceled' at created=3000 (and past_due/unpaid up to 5000).
    // A checkout event that is genuinely OLDER (created=100) arrives late.
    // A resurrection here would hand a canceled account full access for free.
    retrieve.mockResolvedValue(sub({ status: "active" }));
    constructEvent.mockReturnValue({
      id: "evt_stale_checkout", type: "checkout.session.completed", created: 100,
      data: { object: { metadata: { org_id: org.id }, subscription: SUB, customer: CUSTOMER } },
    });
    await POST(req());
    const row = await orgRow();
    // Must still be denied.
    expect(access(row)).toBe("none");
  });


  it("a genuine re-subscribe (newer checkout) reactivates access", async () => {
    // After cancellation, the customer completes a NEW checkout: newer
    // timestamp than anything applied, so it must grant access again.
    retrieve.mockResolvedValue(sub({ status: "active" }));
    constructEvent.mockReturnValue({
      id: "evt_resub", type: "checkout.session.completed", created: 9000,
      data: { object: { metadata: { org_id: org.id }, subscription: SUB, customer: CUSTOMER } },
    });
    await POST(req());
    expect(access(await orgRow())).toBe("full");
  });

});