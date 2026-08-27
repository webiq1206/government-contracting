import { describe, expect, it } from "vitest";
import { expiryFrom, isEmptyCapture, pricingFromCall } from "../lib/domain/call-capture";

const NOW = new Date("2026-03-10T12:00:00.000Z");

describe("pricingFromCall", () => {
  it("turns a stated no into an exclusion in words", () => {
    const p = pricingFromCall(
      { taxes_included: "no", freight_included: "no", mobilization_included: "no" },
      NOW
    );
    expect(p.exclusions).toEqual([
      "Sales tax is not included.",
      "Delivery of materials to site is not included.",
      "Getting their crew and equipment to site is not included.",
    ]);
  });

  it("writes nothing at all for a question nobody asked", () => {
    /*
     * The rule the whole module turns on. Recording "excludes sales tax" on
     * the strength of an unasked question is the platform putting words in a
     * subcontractor's mouth, and a bid reviewer relies on that line.
     */
    const p = pricingFromCall({}, NOW);
    expect(p.exclusions).toEqual([]);
    expect(isEmptyCapture(p)).toBe(true);
  });

  it("writes nothing when the answer was yes", () => {
    const p = pricingFromCall({ taxes_included: "yes", freight_included: "yes" }, NOW);
    expect(p.exclusions).toEqual([]);
  });

  it("keeps whatever the operator typed alongside the yes/no answers", () => {
    const p = pricingFromCall(
      { taxes_included: "no", assumptions: "Permits are on you." },
      NOW
    );
    expect(p.exclusions).toEqual(["Sales tax is not included.", "Permits are on you."]);
  });

  it("turns a validity in days into a date", () => {
    expect(pricingFromCall({ quote_validity_days: 30 }, NOW).quoteExpiresOn).toBe("2026-04-09");
    // Typed into a text field, as it will be.
    expect(pricingFromCall({ quote_validity_days: "30" }, NOW).quoteExpiresOn).toBe("2026-04-09");
  });

  it("gives no expiry rather than todays date when nobody said", () => {
    // A price that expires today is a very different claim from a price
    // nobody put a limit on.
    expect(pricingFromCall({}, NOW).quoteExpiresOn).toBeNull();
    expect(pricingFromCall({ quote_validity_days: 0 }, NOW).quoteExpiresOn).toBeNull();
    expect(pricingFromCall({ quote_validity_days: "soon" }, NOW).quoteExpiresOn).toBeNull();
  });

  it("converts a lead time in weeks to days", () => {
    expect(pricingFromCall({ lead_time_weeks: 6 }, NOW).leadTimeDays).toBe(42);
    expect(pricingFromCall({}, NOW).leadTimeDays).toBeNull();
  });

  it("carries payment terms and availability through as stated", () => {
    const p = pricingFromCall(
      { payment_terms: " Net 30 with monthly draws ", availability: "Booked through September" },
      NOW
    );
    expect(p.paymentTerms).toBe("Net 30 with monthly draws");
    expect(p.availability).toBe("Booked through September");
  });

  it("treats a blank string as nobody having said", () => {
    const p = pricingFromCall({ payment_terms: "   ", availability: "" }, NOW);
    expect(p.paymentTerms).toBeNull();
    expect(p.availability).toBeNull();
  });

  it("records an alternate when one was mentioned", () => {
    expect(pricingFromCall({ alternates: "A cheaper unit" }, NOW).alternates).toEqual([
      "A cheaper unit",
    ]);
    expect(pricingFromCall({}, NOW).alternates).toEqual([]);
  });
});

describe("expiryFrom", () => {
  it("refuses a validity that is not a positive number of days", () => {
    expect(expiryFrom(null, NOW)).toBeNull();
    expect(expiryFrom(0, NOW)).toBeNull();
    expect(expiryFrom(-5, NOW)).toBeNull();
    expect(expiryFrom(Number.NaN, NOW)).toBeNull();
  });
});

describe("isEmptyCapture", () => {
  it("is true only when the call learned none of the six", () => {
    expect(isEmptyCapture(pricingFromCall({}, NOW))).toBe(true);
    expect(isEmptyCapture(pricingFromCall({ payment_terms: "Net 30" }, NOW))).toBe(false);
    expect(isEmptyCapture(pricingFromCall({ taxes_included: "no" }, NOW))).toBe(false);
    // A yes teaches us something and writes nothing, which is not a reason to
    // touch the pricing row.
    expect(isEmptyCapture(pricingFromCall({ taxes_included: "yes" }, NOW))).toBe(true);
  });
});
