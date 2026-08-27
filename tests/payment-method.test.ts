/**
 * "No card" and "we have not been told what the card is" are opposites.
 *
 * One is a reason the next renewal will fail. The other is a gap in this
 * platform's records on an account that is paying perfectly well. They render
 * identically if nobody separates them, and the wrong one sends a customer to
 * fix a card that was never broken.
 */
import { describe, it, expect } from "vitest";
import { describeCard, describeInvoice, money } from "../lib/domain/payment-method";

const NOW = new Date("2026-08-27T00:00:00Z");

describe("describeCard", () => {
  it("says nothing is needed on a comped account", () => {
    const c = describeCard({ billingExempt: true, knownToStripe: false, now: NOW });
    expect(c.value).toBe("None needed");
    expect(c.offerUpdate).toBe(false);
  });

  it("distinguishes no card from no record of one", () => {
    const never = describeCard({ knownToStripe: false, now: NOW });
    expect(never.value).toBe("No card on file");
    // Nothing to update: this account has never been through checkout.
    expect(never.offerUpdate).toBe(false);

    const unknown = describeCard({ knownToStripe: true, now: NOW });
    expect(unknown.value).toBe("Not recorded here");
    expect(unknown.value).not.toMatch(/no card/i);
    expect(unknown.offerUpdate).toBe(true);
  });

  it("names the card without inventing an expiry it was not given", () => {
    const c = describeCard({ brand: "visa", last4: "4242", knownToStripe: true, now: NOW });
    expect(c.value).toBe("Visa ending 4242");
    expect(c.detail).toBeUndefined();
    expect(c.warning).toBeUndefined();
  });

  it("treats a card as good through the last day of its expiry month", () => {
    const thisMonth = describeCard({
      brand: "visa", last4: "4242", expMonth: 8, expYear: 2026, knownToStripe: true, now: NOW,
    });
    expect(thisMonth.tone).toBe("warn");
    expect(thisMonth.warning).toMatch(/end of this month/);

    const lastMonth = describeCard({
      brand: "visa", last4: "4242", expMonth: 7, expYear: 2026, knownToStripe: true, now: NOW,
    });
    expect(lastMonth.tone).toBe("bad");
    expect(lastMonth.warning).toMatch(/expired/);
  });

  it("warns a month before, and stays quiet beyond that", () => {
    const next = describeCard({
      brand: "amex", last4: "0005", expMonth: 9, expYear: 2026, knownToStripe: true, now: NOW,
    });
    expect(next.warning).toMatch(/next month/);

    const later = describeCard({
      brand: "amex", last4: "0005", expMonth: 10, expYear: 2026, knownToStripe: true, now: NOW,
    });
    expect(later.warning).toBeUndefined();
    expect(later.tone).toBe("good");
    expect(later.detail).toBe("Expires 10/2026");
  });
});

describe("describeInvoice", () => {
  it("reports the amount actually taken on a paid invoice", () => {
    const line = describeInvoice({ status: "paid", amountPaidCents: 29900, amountDueCents: 49700 });
    expect(line.outcome).toBe("Paid");
    expect(line.amount).toBe("$299.00");
  });

  it("carries the refusal reason on a failed one", () => {
    const line = describeInvoice({
      status: "uncollectible",
      amountDueCents: 29900,
      failureReason: "Your card was declined.",
    });
    expect(line.tone).toBe("bad");
    expect(line.note).toBe("Your card was declined.");
  });

  it("says a voided invoice took nothing, rather than showing a charge", () => {
    const line = describeInvoice({ status: "void", amountDueCents: 29900 });
    expect(line.note).toMatch(/Nothing was taken/);
    expect(line.tone).toBe("neutral");
  });

  it("returns null rather than zero when no amount was recorded", () => {
    expect(describeInvoice({ status: "paid" }).amount).toBeNull();
    expect(money(null)).toBeNull();
    expect(money(0)).toBe("$0.00");
  });
});
