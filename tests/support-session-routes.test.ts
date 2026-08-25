/**
 * Behavioural proof that the support-session guards actually run.
 *
 * The source sweeps in support-session-guards.test.ts prove a guard is
 * mentioned in each file. These prove it fires, and fires before the code it
 * is protecting: the Stripe client and the Gmail client are mocked to throw,
 * so if a guard is ever moved below the thing it guards, the test does not
 * quietly pass with a 403 that arrived too late.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const ADMIN_EMAIL = "admin@example.com";

let auth: Record<string, unknown> = {};

vi.mock("../lib/api-auth", () => ({
  requireUser: vi.fn(async () => auth),
  // change-plan guards with requireCapability("manage_billing") now. This
  // suite is about the support-session refusal happening BEFORE Stripe or the
  // tenant is touched, so the permission layer resolves to the same fixture.
  requireCapability: vi.fn(async () => auth),
  requireSubscriber: vi.fn(async () => auth),
}));

vi.mock("../lib/tenant", () => ({
  resolveTenantOrgId: vi.fn(async () => {
    throw new Error("tenant resolution should not be reached");
  }),
  // Backlink sending resolves its own organization when a caller does not
  // name one, and does it AFTER the support-session guard. It answers here so
  // the worker case reaches the database mock, which is what proves the guard
  // did not refuse a request that has no session to refuse.
  tryResolveTenantOrgId: vi.fn(async () => "00000000-0000-4000-8000-000000000001"),
}));

vi.mock("../lib/billing/stripe", () => ({
  getStripe: vi.fn(() => {
    throw new Error("Stripe must not be touched during a support session");
  }),
}));

vi.mock("../lib/integrations/gmail", () => ({
  gmail: {
    isConnected: vi.fn(async () => true),
    send: vi.fn(async () => {
      throw new Error("mail must not be sent during a support session");
    }),
  },
}));

vi.mock("../lib/db", () => ({
  query: vi.fn(async () => {
    throw new Error("the database should not be reached before the guard");
  }),
  queryOne: vi.fn(async () => {
    throw new Error("the database should not be reached before the guard");
  }),
  transaction: vi.fn(),
}));

vi.mock("../lib/logger", () => ({ logAgent: vi.fn(async () => {}) }));

let sessionUser: Record<string, unknown> | null = null;
vi.mock("../lib/auth", () => ({
  currentUser: vi.fn(async () => sessionUser),
}));

function customer(extra: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    email: "customer@example.com",
    role: "operator",
    orgRole: "owner",
    organizationId: "org-1",
    subscriptionStatus: "active",
    trialEndsAt: null,
    billingExempt: false,
    suspendedAt: null,
    impersonatedBy: null,
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionUser = null;
  auth = customer();
});

describe("changing plan during a support session", () => {
  /**
   * This route prorates upward with always_invoice, so it can put a real
   * charge on a customer's card. An admin reproducing a billing complaint
   * must not be able to trigger one by clicking through the UI as them.
   */
  it("is refused before Stripe or the tenant is ever resolved", async () => {
    auth = customer({ impersonatedBy: ADMIN_EMAIL });
    const { POST } = await import("../app/api/billing/change-plan/route");

    const res = await POST(
      new Request("http://localhost/api/billing/change-plan", {
        method: "POST",
        body: JSON.stringify({ plan: "founding", interval: "year" }),
      })
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(JSON.stringify(body)).toMatch(/support session/i);
  });

  it("gets past the guard for an ordinary session", async () => {
    auth = customer();
    const { POST } = await import("../app/api/billing/change-plan/route");

    // The mocks throw beyond this point on purpose. Reaching them is the
    // proof that the guard did not fire, which is what we want here.
    await expect(
      POST(
        new Request("http://localhost/api/billing/change-plan", {
          method: "POST",
          body: JSON.stringify({ plan: "standard", interval: "month" }),
        })
      )
    ).rejects.toThrow(/should not be reached|must not be touched/);
  });
});

describe("backlink outreach during a support session", () => {
  it("refuses before it reads the draft or opens Gmail", async () => {
    sessionUser = customer({ impersonatedBy: ADMIN_EMAIL });
    const { sendApprovedOutreach } = await import("../lib/backlink-send");

    const out = await sendApprovedOutreach("00000000-0000-4000-8000-000000000009");
    expect(out.status).toBe("skipped");
    expect((out as { reason: string }).reason).toMatch(/support session/i);
  });

  it("does not refuse the worker, which has no session at all", async () => {
    sessionUser = null;
    const { sendApprovedOutreach } = await import("../lib/backlink-send");

    // Falls through the guard and hits the throwing db mock, which is exactly
    // the behaviour scheduled sending needs: unaffected by this feature.
    await expect(
      sendApprovedOutreach("00000000-0000-4000-8000-000000000009")
    ).rejects.toThrow(/should not be reached/);
  });
});
