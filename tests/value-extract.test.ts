import { describe, it, expect } from "vitest";
import { extractValueFromText, resolveEstimatedValue } from "@/lib/domain/value-extract";

describe("extractValueFromText", () => {
  it("reads a plain dollar figure with context", () => {
    expect(extractValueFromText("The estimated value of this contract is $250,000.")).toBe(
      250_000
    );
  });

  it("expands K/M/B suffixes", () => {
    expect(extractValueFromText("Ceiling not to exceed $1.2M over the base year.")).toBe(
      1_200_000
    );
    expect(extractValueFromText("Total contract value: $850K")).toBe(850_000);
    expect(extractValueFromText("A magnitude of $2.5 billion IDIQ vehicle.")).toBe(2_500_000_000);
  });

  it("takes the upper bound of a stated range", () => {
    expect(
      extractValueFromText("Estimated value between $50,000 and $75,000 annually.")
    ).toBe(75_000);
  });

  it("ignores wage, bonding, and penalty figures even with a $ sign", () => {
    expect(extractValueFromText("Prevailing wage of $28.50 per hour applies.")).toBeNull();
    expect(
      extractValueFromText("Contractor must carry a bonding requirement of $100,000.")
    ).toBeNull();
    expect(extractValueFromText("Liquidated damages of $500 per day for delay.")).toBeNull();
  });

  it("prefers a value-context figure over a nearby unrelated one", () => {
    // The $500 late-fee should be excluded; the $180,000 IGCE should win.
    const text =
      "Late fee of $500 per day applies. The Independent Government Cost Estimate (IGCE) is $180,000.";
    expect(extractValueFromText(text)).toBe(180_000);
  });

  it("rejects implausibly small or large figures", () => {
    expect(extractValueFromText("Application fee of $50.")).toBeNull();
    expect(extractValueFromText("A budget of $99,999,999,999,999.")).toBeNull();
  });

  it("returns null when there is no dollar figure at all", () => {
    expect(extractValueFromText("Routine janitorial services, five days a week.")).toBeNull();
  });

  it("returns null for empty or missing text", () => {
    expect(extractValueFromText(null)).toBeNull();
    expect(extractValueFromText("")).toBeNull();
  });

  it("falls back to the largest plausible figure when nothing has context", () => {
    // No positive/negative keywords near either number: takes the larger,
    // consistent with "prefer the ceiling" when genuinely ambiguous.
    expect(extractValueFromText("Two line items: $12,000 and $45,000.")).toBe(45_000);
  });
});

describe("resolveEstimatedValue", () => {
  it("prefers SAM's own award amount above all else", () => {
    const r = resolveEstimatedValue({
      listedAmount: 300_000,
      description: "Estimated value $1,000,000.",
    });
    expect(r).toEqual({ amount: 300_000, source: "listed" });
  });

  it("falls back to the listing text when SAM has no award amount", () => {
    const r = resolveEstimatedValue({
      title: "Grounds Maintenance",
      description: "Estimated value approximately $210,000.",
    });
    expect(r).toEqual({ amount: 210_000, source: "extracted" });
  });

  it("falls back to the Solicitation Analyst's read as the last resort", () => {
    const r = resolveEstimatedValue({
      title: "Grounds Maintenance",
      description: "No pricing mentioned in the listing.",
      analysisEstimatedValue: "Approximately $95,000 based on the IGCE in Attachment C.",
    });
    expect(r).toEqual({ amount: 95_000, source: "analysis" });
  });

  it("returns null when nothing anywhere yields a plausible value", () => {
    expect(
      resolveEstimatedValue({
        title: "Grounds Maintenance",
        description: "No value published.",
        analysisEstimatedValue: "Not specified in the provided documents",
      })
    ).toBeNull();
  });
});
