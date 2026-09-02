import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";


describe("dashboard tables become cards on a phone", () => {
  it("gives the opportunities table a card lane", () => {
    const src = readFileSync("components/opportunities-table.tsx", "utf8");
    expect(src).toContain("OpportunityTableCard");
    expect(src).toContain("Waiting on you");
  });

  it("gives the admin accounts table a card lane", () => {
    const src = readFileSync("components/admin-accounts-table.tsx", "utf8");
    expect(src).toContain("AdminAccountCard");
    expect(src).toContain("card={(r) => <AdminAccountCard");
  });

  it("does not leave analytics breakdowns as a sideways table on a phone", () => {
    const src = readFileSync("app/(dash)/analytics/page.tsx", "utf8");
    expect(src).toContain('ul className="divide-y divide-border lg:hidden"');
    expect(src).toContain("hidden overflow-x-auto lg:block");
  });

  it("does not leave admin billing, invitations, or audit as phone-only tables", () => {
    const billing = readFileSync("app/(dash)/admin/billing/page.tsx", "utf8");
    const invitations = readFileSync("app/(dash)/admin/invitations/page.tsx", "utf8");
    const audit = readFileSync("app/(dash)/admin/audit/page.tsx", "utf8");
    expect(billing).toContain("space-y-2 lg:hidden");
    expect(invitations).toContain("space-y-2 lg:hidden");
    expect(audit).toContain("space-y-2 lg:hidden");
    expect(billing).toContain("hidden overflow-x-auto lg:block");
    expect(invitations).toContain("hidden overflow-x-auto lg:block");
    expect(audit).toContain("hidden overflow-x-auto lg:block");
  });

  it("turns remaining record tables into cards on a phone", () => {
    const quotes = readFileSync("app/(dash)/subs/[id]/page.tsx", "utf8");
    const reverify = readFileSync("components/reverify-panel.tsx", "utf8");
    const pricing = readFileSync("components/pricing-workspace.tsx", "utf8");
    const docs = readFileSync("components/document-inventory-panel.tsx", "utf8");
    expect(quotes).toContain('ul className="divide-y divide-border lg:hidden"');
    expect(reverify).toContain('ul className="divide-y divide-border lg:hidden"');
    expect(pricing).toContain('ul className="divide-y divide-border lg:hidden"');
    expect(docs).toContain('ul className="divide-y divide-border lg:hidden"');
    expect(docs).not.toContain("md:hidden");
    expect(docs).not.toContain("md:block");
  });

  it("gives settings a picker on a phone instead of an eight-tab strip", () => {
    const src = readFileSync("components/settings-nav.tsx", "utf8");
    expect(src).toContain('id="settings-section"');
    expect(src).toContain("lg:hidden");
    expect(src).toContain("lg:flex");
  });
});
