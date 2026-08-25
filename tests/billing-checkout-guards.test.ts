/**
 * Who is allowed to reach Stripe checkout at all.
 *
 * The billing page decides what to show, but showing and allowing are
 * different things: anyone can type the URL. These pin the refusals down at
 * the endpoint, where they are actually enforced.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const auth = {
  id: "user-1",
  email: "owner@example.test",
  orgRole: "owner",
  organizationId: "org-1",
  impersonatedBy: null as string | null,
};

const org: Record<string, unknown> = {
  id: "org-1",
  billing_exempt: false,
  stripe_customer_id: null,
  stripe_subscription_id: null,
  pending_coupon_id: null,
};

const createCheckoutSession = vi.fn(async () => ({ url: "https://stripe.test/session" }));

vi.mock("../lib/api-auth", () => ({
  requireUser: async () => auth,
}));
vi.mock("../lib/organizations", () => ({
  getOrganization: async () => org,
}));
vi.mock("../lib/billing/promo", () => ({
  getFoundingPromo: async () => ({ active: false }),
}));
vi.mock("../lib/analytics", () => ({
  trackEvent: async () => {},
}));
vi.mock("../lib/admin/invitations", () => ({
  invitedTermsForOrg: async () => null,
}));
vi.mock("../lib/billing/stripe", () => ({
  appBaseUrl: () => "https://app.test",
  stripeEnabled: () => true,
  createCheckoutSession,
}));
vi.mock("../lib/billing/catalog", () => ({
  billingConfigured: () => ({ ok: true, missing: [] as string[] }),
}));

async function checkout(url = "https://app.test/api/billing/checkout") {
  const { GET } = await import("../app/api/billing/checkout/route");
  return GET(new Request(url));
}

describe("who may start a paid subscription", () => {
  beforeEach(() => {
    createCheckoutSession.mockClear();
    auth.impersonatedBy = null;
    org.billing_exempt = false;
    org.stripe_customer_id = null;
    org.pending_coupon_id = null;
  });

  it("refuses an account that was given a free account", async () => {
    // Somebody told "Free account. Nothing to pay, ever." must not be able to
    // start paying by typing the URL. The plan picker is hidden for these
    // accounts, but hiding is presentation and this is the guard.
    org.billing_exempt = true;

    const res = await checkout();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("account_is_free");
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("refuses even when the URL asks for a specific plan", async () => {
    org.billing_exempt = true;
    const res = await checkout(
      "https://app.test/api/billing/checkout?plan=founding&interval=year"
    );
    expect(createCheckoutSession).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toContain("account_is_free");
  });

  it("still lets an ordinary account through", async () => {
    const res = await checkout();
    expect(createCheckoutSession).toHaveBeenCalledTimes(1);
    expect(res.headers.get("location")).toBe("https://stripe.test/session");
  });

  it("refuses a support session, which must never take somebody's card", async () => {
    auth.impersonatedBy = "admin@example.test";
    const res = await checkout();
    expect(createCheckoutSession).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toContain("support_session");
  });

  it("attaches a promised discount as a coupon, never as a typeable code", async () => {
    org.pending_coupon_id = "coupon_123";
    await checkout();
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ couponId: "coupon_123" })
    );
  });
});
