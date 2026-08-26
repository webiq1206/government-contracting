import { describe, it, expect } from "vitest";
import {
  reconcile,
  webhookHealth,
  PAST_DUE_GRACE_DAYS,
  WEBHOOK_STALE_HOURS,
  type ReconcileRow,
} from "@/lib/domain/billing-reconciliation";

const NOW = new Date("2026-08-26T12:00:00Z");

function row(over: Partial<ReconcileRow> & { org_id: string }): ReconcileRow {
  return {
    org_name: "Acme Contracting",
    subscription_status: "active",
    amount_cents: 29900,
    ...over,
  };
}

describe("reconcile", () => {
  it("says nothing about an ordinary paying account", () => {
    expect(reconcile([row({ org_id: "1" })], NOW)).toEqual([]);
  });

  it("says nothing about an ordinary comped account with no subscription", () => {
    expect(
      reconcile(
        [row({ org_id: "1", billing_exempt: true, subscription_status: "none", amount_cents: null })],
        NOW
      )
    ).toEqual([]);
  });

  it("flags an account that is comped and being charged", () => {
    const [c] = reconcile([row({ org_id: "1", billing_exempt: true })], NOW);
    expect(c.kind).toBe("comped_but_billing");
    expect(c.severity).toBe("high");
    expect(c.disagreement).toContain("$299");
    // The status is data, so the article in front of it has to be derived.
    expect(c.disagreement).toContain("an active subscription");
    expect(c.cost).toContain("statement");
  });

  it("does not flag a comped account whose subscription charges nothing", () => {
    expect(
      reconcile([row({ org_id: "1", billing_exempt: true, amount_cents: 0 })], NOW)
    ).toEqual([]);
  });

  it("puts the right article in front of a consonant status too", () => {
    const [c] = reconcile(
      [row({ org_id: "1", billing_exempt: true, subscription_status: "past_due" })],
      NOW
    );
    expect(c.disagreement).toContain("a past_due subscription");
  });

  it("flags an account that is suspended and being charged", () => {
    const [c] = reconcile(
      [row({ org_id: "1", suspended_at: "2026-08-01T00:00:00Z" })],
      NOW
    );
    expect(c.kind).toBe("suspended_but_billing");
    expect(c.disagreement).toContain("Aug 1, 2026");
    expect(c.disagreement).toContain("on an active subscription");
    expect(c.cost).toContain("refund");
  });

  it("leaves a short past-due alone, because the grace is deliberate", () => {
    // A renewal that failed on an expired card should not lock somebody out
    // mid-bid while Stripe retries. That is the whole point of the window.
    const c = reconcile(
      [
        row({
          org_id: "1",
          subscription_status: "past_due",
          last_payment_at: "2026-08-20T00:00:00Z",
        }),
      ],
      NOW
    );
    expect(c).toEqual([]);
  });

  it("flags a past-due account that has had free use past the grace", () => {
    const [c] = reconcile(
      [
        row({
          org_id: "1",
          subscription_status: "past_due",
          last_payment_at: "2026-06-01T00:00:00Z",
        }),
      ],
      NOW
    );
    expect(c.kind).toBe("stale_past_due");
    expect(c.disagreement).toContain("86 days");
    expect(PAST_DUE_GRACE_DAYS).toBe(21);
  });

  it("does not flag a past-due account with no payment date to measure from", () => {
    // Guessing an age would produce a confident number about an unknown.
    expect(
      reconcile([row({ org_id: "1", subscription_status: "past_due", last_payment_at: null })], NOW)
    ).toEqual([]);
  });

  it("flags a Stripe subscription our status never caught up with", () => {
    const [c] = reconcile(
      [
        row({
          org_id: "1",
          subscription_status: "none",
          stripe_subscription_id: "sub_123",
          amount_cents: null,
        }),
      ],
      NOW
    );
    expect(c.kind).toBe("subscription_without_status");
    expect(c.action).toContain("webhook delivery");
  });

  it("flags a trial the sweep should have ended", () => {
    const [c] = reconcile(
      [
        row({
          org_id: "1",
          subscription_status: "trial",
          trial_ends_at: "2026-08-10T00:00:00Z",
          amount_cents: null,
        }),
      ],
      NOW
    );
    expect(c.kind).toBe("trial_expired_not_swept");
    expect(c.severity).toBe("medium");
    expect(c.action).toContain("Automation Health");
  });

  it("leaves a live trial alone", () => {
    expect(
      reconcile(
        [
          row({
            org_id: "1",
            subscription_status: "trial",
            trial_ends_at: "2026-08-30T00:00:00Z",
            amount_cents: null,
          }),
        ],
        NOW
      )
    ).toEqual([]);
  });

  it("flags an active subscription with no price, which understates revenue", () => {
    const [c] = reconcile([row({ org_id: "1", amount_cents: null })], NOW);
    expect(c.kind).toBe("paying_without_amount");
    expect(c.cost).toContain("understated");
  });

  it("does not flag a comped account for having no price", () => {
    expect(
      reconcile([row({ org_id: "1", billing_exempt: true, amount_cents: null })], NOW)
    ).toEqual([]);
  });

  it("puts the expensive conflicts first and keeps the order stable", () => {
    const conflicts = reconcile(
      [
        row({ org_id: "1", org_name: "Zulu", amount_cents: null }),
        row({ org_id: "2", org_name: "Alpha", billing_exempt: true }),
        row({ org_id: "3", org_name: "Bravo", amount_cents: null }),
      ],
      NOW
    );
    expect(conflicts[0].severity).toBe("high");
    expect(conflicts[0].orgName).toBe("Alpha");
    expect(conflicts.slice(1).map((c) => c.orgName)).toEqual(["Bravo", "Zulu"]);
  });

  it("reports every conflict an account has, rather than only the first", () => {
    const conflicts = reconcile(
      [
        row({
          org_id: "1",
          billing_exempt: true,
          suspended_at: "2026-08-01T00:00:00Z",
        }),
      ],
      NOW
    );
    expect(conflicts.map((c) => c.kind).sort()).toEqual([
      "comped_but_billing",
      "suspended_but_billing",
    ]);
  });
});

describe("webhookHealth", () => {
  it("calls silence expected when nothing is subscribed", () => {
    // A new deployment hears nothing from Stripe for weeks, correctly.
    const h = webhookHealth(null, 0, NOW);
    expect(h.state).toBe("quiet");
    expect(h.suspect).toBe(false);
  });

  it("calls silence a problem when there are subscriptions to hear about", () => {
    const h = webhookHealth(null, 4, NOW);
    expect(h.state).toBe("never");
    expect(h.suspect).toBe(true);
    expect(h.detail).toContain("never registered");
  });

  it("reports a recent event as healthy", () => {
    const h = webhookHealth("2026-08-26T09:00:00Z", 4, NOW);
    expect(h.state).toBe("healthy");
    expect(h.label).toContain("3 hours ago");
    expect(h.suspect).toBe(false);
  });

  it("marks the whole page suspect once delivery has been silent too long", () => {
    const h = webhookHealth("2026-08-15T12:00:00Z", 4, NOW);
    expect(h.state).toBe("stale");
    expect(h.suspect).toBe(true);
    expect(h.label).toContain("11 days ago");
    expect(WEBHOOK_STALE_HOURS).toBe(72);
  });

  it("does not cry wolf about old events on a deployment with nothing to bill", () => {
    const h = webhookHealth("2026-01-01T12:00:00Z", 0, NOW);
    expect(h.state).toBe("quiet");
    expect(h.suspect).toBe(false);
  });

  it("treats an unparseable timestamp as no event at all", () => {
    expect(webhookHealth("not a date", 3, NOW).state).toBe("never");
  });
});
