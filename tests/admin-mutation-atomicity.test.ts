import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  client: { query: vi.fn() },
  transaction: vi.fn(),
  requiredAudit: vi.fn(),
  bestEffortAudit: vi.fn(),
  clearKeyCache: vi.fn(),
  deleteCoupon: vi.fn(),
  createCoupon: vi.fn(),
  applyDiscount: vi.fn(),
  removeDiscount: vi.fn(),
}));

vi.mock("../lib/db", () => ({
  query: mocks.query,
  queryOne: mocks.queryOne,
  transaction: mocks.transaction,
}));

vi.mock("../lib/admin/audit", () => ({
  recordRequiredAdminAction: mocks.requiredAudit,
  recordAdminAction: mocks.bestEffortAudit,
}));

vi.mock("../lib/integration-keys", () => ({
  clearIntegrationKeyCache: mocks.clearKeyCache,
  platformKeyUsage: vi.fn(async () => []),
}));

vi.mock("../lib/integrations/storage", () => ({
  storage: { removeExternal: vi.fn() },
}));

vi.mock("../lib/platform-admin", () => ({
  isPlatformAdmin: vi.fn(() => false),
  requirePlatformAdmin: vi.fn(async () => ({
    id: "admin-1",
    email: "admin@example.test",
  })),
}));

vi.mock("../lib/billing/concessions", () => ({
  deleteConcessionCoupon: mocks.deleteCoupon,
  createConcessionCode: mocks.createCoupon,
  applyDiscountToSubscription: mocks.applyDiscount,
  removeDiscountFromSubscription: mocks.removeDiscount,
  describeConcession: vi.fn(() => "20% off"),
  generateConcessionCode: vi.fn(() => "SAVE20"),
  needsStripeCode: vi.fn(() => false),
  validateConcession: vi.fn(() => null),
}));

vi.mock("../lib/integrations/system-mail", () => ({
  systemMail: { enabled: vi.fn(async () => false), send: vi.fn() },
}));

vi.mock("../lib/config", () => ({
  config: { appUrl: "https://app.example.test", isProd: true },
}));

const previousAnthropic = process.env.ANTHROPIC_API_KEY;

describe("required audit records for privileged admin mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "platform-key";
    mocks.transaction.mockImplementation(
      async (fn: (client: typeof mocks.client) => Promise<unknown>) => fn(mocks.client)
    );
    mocks.client.query.mockResolvedValue({ rows: [{ id: "row-1" }], rowCount: 1 });
    mocks.requiredAudit.mockResolvedValue(undefined);
    mocks.deleteCoupon.mockResolvedValue({ ok: true });
    mocks.createCoupon.mockResolvedValue({
      ok: true,
      value: { code: "SAVE20", couponId: "coupon-1" },
    });
    mocks.applyDiscount.mockResolvedValue({ ok: true });
    mocks.removeDiscount.mockResolvedValue({ ok: true });
  });

  afterAll(() => {
    if (previousAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousAnthropic;
  });

  it("does not report a billing exemption when its audit witness fails", async () => {
    mocks.queryOne.mockResolvedValueOnce({ name: "Customer" });
    mocks.requiredAudit.mockRejectedValueOnce(new Error("audit unavailable"));
    const { setBillingExempt } = await import("../lib/admin/accounts");

    const result = await setBillingExempt({
      orgId: "org-1",
      exempt: true,
      reason: "Contract term",
      adminEmail: "admin@example.test",
    });

    expect(result.ok).toBe(false);
    expect(mocks.requiredAudit.mock.calls[0]?.[1]).toBe(mocks.client);
    expect(mocks.client.query.mock.calls[0]?.[0]).toContain("update organizations");
  });

  it("keeps an ownership transfer and its audit on one serialized client", async () => {
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("select name from organizations")) {
        return { rows: [{ name: "Customer" }], rowCount: 1 };
      }
      if (sql.includes("select u.email, m.role")) {
        return { rows: [{ email: "new@example.test", role: "admin" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    mocks.requiredAudit.mockRejectedValueOnce(new Error("audit unavailable"));
    const { transferOwnership } = await import("../lib/admin/accounts");

    const result = await transferOwnership({
      orgId: "org-1",
      toUserId: "user-2",
      adminEmail: "admin@example.test",
    });

    expect(result.ok).toBe(false);
    expect(mocks.client.query.mock.calls[0]?.[0]).toContain("for update");
    expect(mocks.requiredAudit.mock.calls[0]?.[1]).toBe(mocks.client);
  });

  it("does not evict the key cache when a grant audit rolls back", async () => {
    mocks.queryOne.mockResolvedValueOnce({ name: "Customer" });
    mocks.requiredAudit.mockRejectedValueOnce(new Error("audit unavailable"));
    const { grantKeyToAccount } = await import("../lib/admin/platform-keys");

    const result = await grantKeyToAccount({
      orgId: "org-1",
      key: "ANTHROPIC_API_KEY",
      note: "Temporary evaluation",
      expiresAt: null,
      adminEmail: "admin@example.test",
      adminUserId: "admin-1",
    });

    expect(result.ok).toBe(false);
    expect(mocks.requiredAudit.mock.calls[0]?.[1]).toBe(mocks.client);
    expect(mocks.clearKeyCache).not.toHaveBeenCalled();
  });

  it("routes the legacy key-grant endpoint through the canonical audited writer", async () => {
    mocks.queryOne.mockResolvedValueOnce({ name: "Customer" });
    const { POST } = await import("../app/api/admin/key-grants/route");
    const response = await POST(
      new Request("https://app.example.test/api/admin/key-grants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId: "11111111-1111-4111-8111-111111111111",
          key: "ANTHROPIC_API_KEY",
          note: "Temporary evaluation",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.requiredAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "platform_key_granted" }),
      mocks.client
    );
  });

  it("leaves an invitation usable when revocation cannot be audited", async () => {
    mocks.queryOne.mockResolvedValueOnce({
      id: "inv-1",
      email: "invitee@example.test",
      accepted_at: null,
      revoked_at: null,
      expires_at: "2099-01-01T00:00:00.000Z",
      stripe_coupon_id: "coupon-1",
      concession_code: "SAVE",
    });
    mocks.requiredAudit.mockRejectedValueOnce(new Error("audit unavailable"));
    const { revokeInvitation } = await import("../lib/admin/invitations");

    const result = await revokeInvitation({
      id: "inv-1",
      adminEmail: "admin@example.test",
    });

    expect(result.ok).toBe(false);
    expect(mocks.requiredAudit.mock.calls[0]?.[1]).toBe(mocks.client);
    expect(mocks.deleteCoupon).not.toHaveBeenCalled();
  });

  it("removes an unused Stripe coupon when a pending concession cannot be audited", async () => {
    mocks.queryOne
      .mockResolvedValueOnce({
        id: "org-1",
        name: "Customer",
        billing_exempt: false,
        subscription_status: "trial",
        trial_ends_at: "2099-01-01T00:00:00.000Z",
        suspended_at: null,
        stripe_subscription_id: null,
      })
      .mockResolvedValueOnce(null);
    mocks.requiredAudit.mockRejectedValueOnce(new Error("audit unavailable"));
    const { grantConcession } = await import("../lib/admin/concessions");

    const result = await grantConcession({
      orgId: "org-1",
      concession: { kind: "percent", percent: 20, months: null },
      reason: "Negotiated rate",
      adminEmail: "admin@example.test",
    });

    expect(result.ok).toBe(false);
    expect(mocks.requiredAudit.mock.calls[0]?.[1]).toBe(mocks.client);
    expect(mocks.deleteCoupon).toHaveBeenCalledWith("coupon-1");
  });
});
