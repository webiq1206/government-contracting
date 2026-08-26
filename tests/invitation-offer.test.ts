import { describe, it, expect } from "vitest";
import { offerPreview } from "@/lib/domain/invitation-offer";
import { PLANS, ANNUAL_MONTHS_CHARGED } from "@/lib/billing/catalog";

const NOW = new Date("2026-08-26T12:00:00Z");

function line(p: ReturnType<typeof offerPreview>, label: string) {
  return p.lines.find((l) => l.label === label);
}

describe("offerPreview", () => {
  it("prices a plain monthly offer from the catalog, not from a second copy", () => {
    const p = offerPreview({
      plan: "standard",
      interval: "month",
      concession: { kind: "none" },
      now: NOW,
    });
    expect(p.normalPrice).toBe(`$${PLANS.standard.monthlyUsd.toLocaleString("en-US")}`);
    expect(p.firstCharge).toBe(p.normalPrice);
    expect(p.discount).toBeNull();
    expect(p.laterCharge).toBeNull();
    expect(p.summary).toContain("at the normal");
  });

  it("prices an annual offer at the months actually charged", () => {
    const p = offerPreview({
      plan: "founding",
      interval: "year",
      concession: { kind: "none" },
      now: NOW,
    });
    const expected = PLANS.founding.monthlyUsd * ANNUAL_MONTHS_CHARGED;
    expect(p.normalPrice).toBe(`$${expected.toLocaleString("en-US")}`);
    expect(p.periodLabel).toContain(`${ANNUAL_MONTHS_CHARGED} months`);
  });

  it("does the percentage arithmetic the administrator was doing in their head", () => {
    const p = offerPreview({
      plan: "founding",
      interval: "month",
      concession: { kind: "percent", percent: 25 },
      now: NOW,
    });
    // 497 less a quarter.
    expect(p.firstCharge).toBe("$373");
    expect(p.discount).toContain("25% off");
    // Open-ended, so there is no "and then" to state.
    expect(p.laterCharge).toBeNull();
  });

  it("says what a time-limited percentage settles at", () => {
    const p = offerPreview({
      plan: "founding",
      interval: "month",
      concession: { kind: "percent", percent: 50, months: 3 },
      now: NOW,
    });
    expect(p.firstCharge).toBe("$249");
    expect(p.laterCharge).toContain("$497");
    expect(p.laterCharge).toContain("3 months");
  });

  it("separates free-for-now from free-forever, which bill differently", () => {
    // A free account never has an invoice. A free month is an invoice later.
    // Rendering both as "$0" would tell somebody their customer is billed
    // nothing on a plan that in fact bills.
    const forever = offerPreview({
      plan: "standard",
      interval: "month",
      concession: { kind: "free_account" },
      now: NOW,
    });
    expect(forever.firstCharge).toBe("Nothing, ever");
    expect(forever.laterCharge).toBeNull();
    expect(forever.summary).toContain("no card is asked for");
    // And the discount note must not describe a checkout step that never runs.
    expect(line(forever, "Discount")?.note).toContain("No checkout and no card");

    const forNow = offerPreview({
      plan: "standard",
      interval: "month",
      concession: { kind: "free_months", months: 3 },
      now: NOW,
    });
    expect(forNow.firstCharge).toContain("Nothing for the first 3");
    expect(forNow.laterCharge).toContain("$1,997");
    // A free run still ends at a checkout, so this one does say so.
    expect(line(forNow, "Discount")?.note).toContain("at checkout");
  });

  it("treats a run of nought free months as no discount at all", () => {
    const p = offerPreview({
      plan: "standard",
      interval: "month",
      concession: { kind: "free_months", months: 0 },
      now: NOW,
    });
    expect(p.firstCharge).toBe("$1,997");
  });

  it("dates the expiry rather than describing it vaguely", () => {
    const p = offerPreview({
      plan: "standard",
      interval: "month",
      concession: { kind: "none" },
      now: NOW,
    });
    expect(p.expiresOn).toBe("September 9, 2026");
    expect(line(p, "Link expires")?.note).toContain("works once");
  });

  it("names the role and says the first person owns the account", () => {
    const p = offerPreview({
      plan: "standard",
      interval: "month",
      concession: { kind: "none" },
      now: NOW,
    });
    expect(p.role).toBe("Owner");
    expect(line(p, "Role")?.note).toContain("owns it");
  });

  it("says the founding rate is locked, because that is the plan's whole promise", () => {
    const p = offerPreview({
      plan: "founding",
      interval: "month",
      concession: { kind: "none" },
      now: NOW,
    });
    expect(line(p, "Plan")?.note).toContain("locked");
    const s = offerPreview({
      plan: "standard",
      interval: "month",
      concession: { kind: "none" },
      now: NOW,
    });
    expect(line(s, "Plan")?.note).toBeUndefined();
  });

  it("carries every field the audit asks the preview to show", () => {
    const p = offerPreview({
      plan: "founding",
      interval: "year",
      concession: { kind: "percent", percent: 10, months: 2 },
      now: NOW,
    });
    const labels = p.lines.map((l) => l.label);
    for (const required of [
      "Plan",
      "Billing period",
      "Normal price",
      "Discount",
      "First charge",
      "Then",
      "Role",
      "Link expires",
    ]) {
      expect(labels).toContain(required);
    }
  });
});
