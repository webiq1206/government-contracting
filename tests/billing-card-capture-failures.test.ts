import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const query = vi.fn();

async function loadInvoices() {
  vi.resetModules();
  vi.doMock("@/lib/db", () => ({ query }));
  return import("@/lib/billing/invoices");
}

afterEach(() => {
  query.mockReset();
  vi.doUnmock("@/lib/db");
  vi.resetModules();
});

describe("billing card-summary persistence", () => {
  it("rejects a database failure instead of logging it only to the console", async () => {
    query.mockRejectedValueOnce(new Error("card write failed"));
    const { recordPaymentMethod } = await loadInvoices();

    await expect(
      recordPaymentMethod("11111111-1111-4111-8111-111111111111", {
        brand: "visa",
        last4: "4242",
        expMonth: 9,
        expYear: 2030,
      })
    ).rejects.toThrow("card write failed");
  });

  it("rejects a zero-row update rather than claiming an absent account was updated", async () => {
    query.mockResolvedValueOnce([]);
    const { recordPaymentMethod } = await loadInvoices();

    await expect(
      recordPaymentMethod("11111111-1111-4111-8111-111111111111", {
        brand: "visa",
        last4: "4242",
      })
    ).rejects.toThrow("account no longer exists");
  });

  it("keeps the explicit no-card case as a legitimate no-op", async () => {
    const { recordPaymentMethod } = await loadInvoices();

    await recordPaymentMethod("11111111-1111-4111-8111-111111111111", null);
    await recordPaymentMethod("11111111-1111-4111-8111-111111111111", { last4: null });

    expect(query).not.toHaveBeenCalled();
  });
});

describe("Stripe webhook card-capture ordering", () => {
  const source = readFileSync("app/api/billing/webhook/route.ts", "utf8");

  it("durably records read/save failures in the tenant audit trail", () => {
    const helper = source.slice(
      source.indexOf("async function recordCardCaptureFailure"),
      source.indexOf("async function captureCard")
    );
    expect(helper).toContain("insert into agent_logs");
    expect(helper).toContain("org_id");
    expect(helper).toContain("payment-method-capture-failed");
  });

  it("captures before lifecycle mutations and customer notices, so a retry cannot duplicate them", () => {
    const checkout = source.slice(
      source.indexOf('case "checkout.session.completed"'),
      source.indexOf('case "customer.subscription.created"')
    );
    expect(checkout.indexOf("await captureCard")).toBeGreaterThan(-1);
    expect(checkout.indexOf("await captureCard")).toBeLessThan(
      checkout.indexOf("await updateOrganizationBilling")
    );
    expect(checkout.indexOf("await captureCard")).toBeLessThan(
      checkout.indexOf("await notifyTrialStarted")
    );

    const subscription = source.slice(
      source.indexOf('case "customer.subscription.created"'),
      source.indexOf('case "customer.subscription.trial_will_end"')
    );
    expect(subscription.indexOf("await captureCard")).toBeGreaterThan(-1);
    expect(subscription.indexOf("await captureCard")).toBeLessThan(
      subscription.indexOf("await updateOrganizationBilling")
    );
    expect(subscription.indexOf("await captureCard")).toBeLessThan(
      subscription.indexOf("await notifyCanceled")
    );
  });
});
