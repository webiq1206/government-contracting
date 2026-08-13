import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

/**
 * The webhook is the only thing standing between a forged HTTP request and a
 * free paid subscription, so these tests are mostly about what it refuses.
 */
const constructEvent = vi.fn();
const retrieve = vi.fn();

async function load(env: Record<string, string | undefined> = {}) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.doMock("@/lib/billing/stripe", () => ({
    getStripe: () =>
      process.env.STRIPE_SECRET_KEY
        ? { webhooks: { constructEvent }, subscriptions: { retrieve } }
        : null,
  }));
  vi.doMock("@/lib/db", () => ({ query: vi.fn(async () => []), queryOne: vi.fn(async () => null) }));
  vi.doMock("@/lib/organizations", () => ({ updateOrganizationBilling: vi.fn(async () => {}) }));
  vi.doMock("@/lib/analytics", () => ({ trackEvent: vi.fn(async () => {}) }));
  vi.doMock("@/lib/billing/notify", () => ({
    notifyTrialStarted: vi.fn(async () => {}),
    notifyTrialEnding: vi.fn(async () => {}),
    notifyPaymentSucceeded: vi.fn(async () => {}),
    notifyPaymentFailed: vi.fn(async () => {}),
    notifyCanceled: vi.fn(async () => {}),
    notifyReactivated: vi.fn(async () => {}),
  }));
  return import("@/app/api/billing/webhook/route");
}

const req = (body = "{}") =>
  new Request("https://brostco.com/api/billing/webhook", {
    method: "POST",
    body,
    headers: { "stripe-signature": "sig" },
  });

beforeEach(() => {
  constructEvent.mockReset();
  retrieve.mockReset();
});

afterEach(() => {
  vi.doUnmock("@/lib/billing/stripe");
  vi.doUnmock("@/lib/db");
  vi.doUnmock("@/lib/organizations");
  vi.doUnmock("@/lib/analytics");
  vi.doUnmock("@/lib/billing/notify");
  vi.resetModules();
});

describe("the webhook refuses anything it cannot prove came from Stripe", () => {
  it("refuses every event when no webhook secret is configured", async () => {
    // The old code parsed unsigned JSON here, so a forged POST could activate
    // a paid subscription for free.
    const mod = await load({ STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: undefined });
    const res = await mod.POST(req());
    expect(res.status).toBe(503);
    expect(constructEvent).not.toHaveBeenCalled();
  });

  it("rejects a bad signature", async () => {
    const mod = await load({ STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_x" });
    constructEvent.mockImplementation(() => {
      throw new Error("no match");
    });
    const res = await mod.POST(req());
    expect(res.status).toBe(400);
  });

  it("returns 503 when Stripe is not configured at all", async () => {
    const mod = await load({ STRIPE_SECRET_KEY: undefined, STRIPE_WEBHOOK_SECRET: "whsec_x" });
    expect((await mod.POST(req())).status).toBe(503);
  });
});

describe("processing an event exactly once", () => {
  it("skips an event it has already claimed", async () => {
    vi.resetModules();
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
    vi.doMock("@/lib/billing/stripe", () => ({
      getStripe: () => ({ webhooks: { constructEvent }, subscriptions: { retrieve } }),
    }));
    // claimEvent returns no row on conflict, meaning already processed.
    vi.doMock("@/lib/db", () => ({
      query: vi.fn(async () => []),
      queryOne: vi.fn(async () => null),
    }));
    vi.doMock("@/lib/organizations", () => ({ updateOrganizationBilling: vi.fn() }));
    vi.doMock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
    vi.doMock("@/lib/billing/notify", () => ({
      notifyTrialStarted: vi.fn(),
      notifyTrialEnding: vi.fn(),
      notifyPaymentSucceeded: vi.fn(),
      notifyPaymentFailed: vi.fn(),
      notifyCanceled: vi.fn(),
      notifyReactivated: vi.fn(),
    }));
    constructEvent.mockReturnValue({
      id: "evt_1",
      type: "checkout.session.completed",
      created: 1,
      data: { object: {} },
    });
    const mod = await import("@/app/api/billing/webhook/route");
    const res = await mod.POST(req());
    expect(await res.json()).toMatchObject({ duplicate: true });
    // The handler must not have run: no subscription was retrieved.
    expect(retrieve).not.toHaveBeenCalled();
  });
});
