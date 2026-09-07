import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const query = vi.fn();
const queryOne = vi.fn();
const systemSend = vi.fn();

async function loadPromo() {
  vi.resetModules();
  vi.doMock("../lib/db", () => ({ query, queryOne }));
  return import("../lib/billing/promo");
}

async function loadTrialLimits() {
  vi.resetModules();
  vi.doMock("../lib/db", () => ({ query, queryOne }));
  return import("../lib/billing/trial-limits");
}

async function loadNotify() {
  vi.resetModules();
  vi.doMock("../lib/db", () => ({ query, queryOne }));
  vi.doMock("../lib/integrations/system-mail", () => ({
    systemMail: { send: systemSend },
  }));
  vi.doMock("../lib/config", () => ({
    config: { appUrl: "https://brostco.com" },
  }));
  return import("../lib/billing/notify");
}

afterEach(() => {
  delete process.env.FOUNDING_PROMO_ENDS_AT;
  query.mockReset();
  queryOne.mockReset();
  systemSend.mockReset();
  vi.restoreAllMocks();
  vi.doUnmock("../lib/db");
  vi.doUnmock("../lib/integrations/system-mail");
  vi.doUnmock("../lib/config");
  vi.resetModules();
});

describe("founding promotion truth", () => {
  it("propagates a settings read failure instead of inventing an inactive window", async () => {
    queryOne.mockRejectedValueOnce(new Error("settings unavailable"));
    const { getFoundingPromo } = await loadPromo();

    await expect(getFoundingPromo({ startIfMissing: false })).rejects.toThrow(
      "settings unavailable"
    );
  });

  it("does not claim a newly started window when its write fails", async () => {
    queryOne.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("write failed"));
    const { getFoundingPromo } = await loadPromo();

    await expect(getFoundingPromo()).rejects.toThrow("write failed");
  });

  it("returns the persisted winner when two requests start the window together", async () => {
    const winner = {
      value_json: {
        started_at: "2026-09-07T12:00:00.000Z",
        ends_at: "2026-09-12T12:00:00.000Z",
        duration_days: 5,
      },
    };
    queryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);
    const { getFoundingPromo } = await loadPromo();

    const promo = await getFoundingPromo();

    expect(promo.startedAt).toBe(winner.value_json.started_at);
    expect(promo.endsAt).toBe(winner.value_json.ends_at);
    expect(queryOne).toHaveBeenCalledTimes(3);
  });

  it("rejects invalid persisted and environment timestamps", async () => {
    queryOne.mockResolvedValueOnce({
      value_json: { ends_at: "not-a-date", duration_days: 5 },
    });
    let mod = await loadPromo();
    await expect(mod.getFoundingPromo({ startIfMissing: false })).rejects.toThrow(
      "ends_at is not a valid timestamp"
    );

    queryOne.mockReset();
    queryOne.mockResolvedValueOnce(null);
    process.env.FOUNDING_PROMO_ENDS_AT = "not-a-date";
    mod = await loadPromo();
    await expect(mod.getFoundingPromo({ startIfMissing: false })).rejects.toThrow(
      "FOUNDING_PROMO_ENDS_AT"
    );
  });

  it("holds checkout and plan changes when promotion eligibility is unreadable", () => {
    const checkout = readFileSync("app/api/billing/checkout/route.ts", "utf8");
    const changePlan = readFileSync("app/api/billing/change-plan/route.ts", "utf8");
    const billingPage = readFileSync("app/(account)/settings/billing/page.tsx", "utf8");

    expect(checkout).toContain("error=promo_unavailable");
    expect(checkout).toContain("founding promotion eligibility could not be read");
    expect(changePlan).toContain("Promotion eligibility could not be verified");
    expect(changePlan).toContain("{ status: 503 }");
    expect(billingPage).toContain('searchParams?.error === "promo_unavailable"');
    expect(billingPage).toContain("checkout was stopped before any");
  });
});

describe("trial quota enforcement truth", () => {
  it("holds work when the organization id is missing", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { checkTrialQuota } = await loadTrialLimits();

    const decision = await checkTrialQuota(null, "outreach_emails");

    expect(decision.allowed).toBe(false);
    expect(decision.message).toContain("could not be verified");
    expect(query).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalled();
  });

  it("holds work when account state cannot be read or the account is absent", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    query.mockRejectedValueOnce(new Error("database offline"));
    let mod = await loadTrialLimits();

    const unreadable = await mod.checkTrialQuota("org-1", "ai_briefs");
    expect(unreadable.allowed).toBe(false);
    expect(unreadable.message).toMatch(/support reference QUOTA-AI-BRIEFS-[0-9a-f]{8}/);

    query.mockReset();
    query.mockResolvedValueOnce([]);
    mod = await loadTrialLimits();
    const missing = await mod.checkTrialQuota("org-gone", "bid_packages");
    expect(missing.allowed).toBe(false);
    expect(missing.message).toContain("held");
    expect(errors).toHaveBeenCalled();
  });

  it("holds a trial action when its meter cannot be counted", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    query
      .mockResolvedValueOnce([
        {
          subscription_status: "trial",
          trial_ends_at: "2099-01-01T00:00:00.000Z",
          billing_exempt: false,
          suspended_at: null,
        },
      ])
      .mockRejectedValueOnce(new Error("count unavailable"));
    const { checkTrialQuota } = await loadTrialLimits();

    const decision = await checkTrialQuota("org-1", "outreach_emails");

    expect(decision.allowed).toBe(false);
    expect(decision.state?.used).toBeNull();
    expect(decision.message).toContain(decision.state!.unreadable!.reference);
    expect(errors).toHaveBeenCalled();
  });

  it("does not turn an invalid count result into zero", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    query.mockResolvedValueOnce([]);
    const { quotaState } = await loadTrialLimits();

    const state = await quotaState("org-1", "bid_packages");

    expect(state.used).toBeNull();
    expect(state.remaining).toBeNull();
    expect(state.unreadable).toBeTruthy();
    expect(errors).toHaveBeenCalled();
  });

  it("still lets a verified paid account bypass trial meters", async () => {
    query.mockResolvedValueOnce([
      {
        subscription_status: "active",
        trial_ends_at: null,
        billing_exempt: false,
        suspended_at: null,
      },
    ]);
    const { checkTrialQuota } = await loadTrialLimits();

    await expect(checkTrialQuota("org-paid", "ai_briefs")).resolves.toEqual({ allowed: true });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("names the actual access problem instead of calling every refusal an expired trial", async () => {
    query.mockResolvedValueOnce([
      {
        subscription_status: "canceled",
        trial_ends_at: null,
        billing_exempt: false,
        suspended_at: null,
      },
    ]);
    const { checkTrialQuota } = await loadTrialLimits();

    const decision = await checkTrialQuota("org-canceled", "bid_packages");

    expect(decision.allowed).toBe(false);
    expect(decision.message).toContain("subscription is canceled");
    expect(decision.message).not.toContain("free trial");
  });

  it("counts provider-accepted email and built artifacts, not drafts or placeholder bids", () => {
    const source = readFileSync("lib/billing/trial-limits.ts", "utf8");
    expect(source).toContain("provider is not null");
    expect(source).toContain("gmail_message_id is not null");
    expect(source).toContain("rfc822_message_id is not null");
    expect(source).toContain("jsonb_array_length(documents_json) > 0");
  });
});

describe("billing notification delivery truth", () => {
  const context = {
    orgId: "11111111-1111-4111-8111-111111111111",
    eventId: "evt_payment_failed",
    amountCents: 49700,
    reason: "Card declined",
    nextAttemptAt: null,
    invoiceUrl: null,
  };

  it("records pending before calling Gmail, then records provider failure without throwing", async () => {
    queryOne.mockResolvedValueOnce({ email: "owner@example.test", name: "Owner" });
    query.mockResolvedValueOnce([{ id: context.eventId }]);
    query.mockResolvedValueOnce([{ id: context.eventId }]);
    query.mockResolvedValueOnce([]);
    systemSend.mockResolvedValueOnce({ error: "Google rejected the grant" });
    const { notifyPaymentFailed } = await loadNotify();

    await expect(notifyPaymentFailed(context)).resolves.toBeUndefined();

    expect(String(query.mock.calls[0][0])).toContain("notification_status = 'pending'");
    expect(systemSend).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[1][1]).toEqual([
      context.eventId,
      "failed",
      "Google rejected the grant",
      null,
      context.orgId,
    ]);
    expect(String(query.mock.calls[2][0])).toContain("billing-notification-failed");
  });

  it("leaves the durable pending marker and does not replay when result persistence fails", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    queryOne.mockResolvedValueOnce({ email: "owner@example.test", name: null });
    query
      .mockResolvedValueOnce([{ id: context.eventId }])
      .mockRejectedValueOnce(new Error("result write failed"))
      .mockResolvedValueOnce([]);
    systemSend.mockResolvedValueOnce({ error: "provider timeout" });
    const { notifyPaymentFailed } = await loadNotify();

    await expect(notifyPaymentFailed(context)).resolves.toBeUndefined();

    expect(systemSend).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalled();
    expect(String(query.mock.calls[0][0])).toContain("notification_status = 'pending'");
  });

  it("does not send again when the event already has notification state", async () => {
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    queryOne
      .mockResolvedValueOnce({ email: "owner@example.test", name: null })
      .mockResolvedValueOnce({ org_id: context.orgId, notification_status: "sent" });
    query.mockResolvedValueOnce([]);
    const { notifyPaymentFailed } = await loadNotify();

    await notifyPaymentFailed(context);

    expect(systemSend).not.toHaveBeenCalled();
    expect(warnings).toHaveBeenCalledWith(expect.stringContaining("no duplicate was sent"));
  });

  it("records a missing owner as a durable failed notice", async () => {
    queryOne.mockResolvedValueOnce(null);
    query.mockResolvedValueOnce([{ id: context.eventId }]).mockResolvedValueOnce([]);
    const { notifyPaymentFailed } = await loadNotify();

    await notifyPaymentFailed(context);

    expect(systemSend).not.toHaveBeenCalled();
    expect(String(query.mock.calls[0][0])).toContain("notification_status = 'failed'");
    expect(String(query.mock.calls[1][0])).toContain("billing-notification-failed");
  });

  it("fails before Gmail when owner or pending-state reads cannot be persisted", async () => {
    queryOne.mockRejectedValueOnce(new Error("owner lookup failed"));
    let mod = await loadNotify();
    await expect(mod.notifyPaymentFailed(context)).rejects.toThrow("owner lookup failed");
    expect(systemSend).not.toHaveBeenCalled();

    queryOne.mockReset();
    query.mockReset();
    queryOne.mockResolvedValueOnce({ email: "owner@example.test", name: null });
    query.mockRejectedValueOnce(new Error("claim write failed"));
    mod = await loadNotify();
    await expect(mod.notifyPaymentFailed(context)).rejects.toThrow("claim write failed");
    expect(systemSend).not.toHaveBeenCalled();
  });

  it("records confirmed delivery on the same Stripe event", async () => {
    queryOne.mockResolvedValueOnce({ email: "owner@example.test", name: null });
    query
      .mockResolvedValueOnce([{ id: context.eventId }])
      .mockResolvedValueOnce([{ id: context.eventId }]);
    systemSend.mockResolvedValueOnce({ messageId: "gmail-123" });
    const { notifyPaymentFailed } = await loadNotify();

    await notifyPaymentFailed(context);

    expect(query.mock.calls[1][1]).toEqual([
      context.eventId,
      "sent",
      null,
      "gmail-123",
      context.orgId,
    ]);
  });

  it("keeps delivery pending when Gmail returns no message id", async () => {
    queryOne.mockResolvedValueOnce({ email: "owner@example.test", name: null });
    query.mockResolvedValueOnce([{ id: context.eventId }]).mockResolvedValueOnce([]);
    systemSend.mockResolvedValueOnce({});
    const { notifyPaymentFailed } = await loadNotify();

    await notifyPaymentFailed(context);

    expect(query).toHaveBeenCalledTimes(2);
    expect(String(query.mock.calls[0][0])).toContain("notification_status = 'pending'");
    expect(String(query.mock.calls[1][0])).toContain("billing-notification-failed");
    expect(String(query.mock.calls[1][1][1])).toContain("Delivery is unconfirmed");
  });
});

describe("billing notification schema and webhook wiring", () => {
  const migration = readFileSync(
    "db/migrations/108_billing_notification_delivery.sql",
    "utf8"
  );
  const webhook = readFileSync("app/api/billing/webhook/route.ts", "utf8");

  it("stores pending, sent, and failed independently from Stripe handler errors", () => {
    expect(migration).toContain("notification_status");
    expect(migration).toContain("'pending', 'sent', 'failed'");
    expect(migration).toContain("notification_message_id");
    expect(migration).not.toMatch(/force\s+row\s+level\s+security/i);
  });

  it("passes the Stripe event id to every billing notice", () => {
    const calls = webhook.match(/await notify(?:TrialStarted|TrialEnding|PaymentSucceeded|PaymentFailed|Canceled|Reactivated)\(\{[\s\S]*?\}\);/g) ?? [];
    expect(calls).toHaveLength(7);
    for (const call of calls) expect(call).toContain("eventId: event.id");
  });
});
