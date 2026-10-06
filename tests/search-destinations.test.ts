import { describe, expect, it } from "vitest";
import { searchDestinations } from "@/lib/domain/search-destinations";
import { NAVIGATION_SECTIONS, SETTINGS_DESTINATIONS } from "@/lib/navigation";

describe("navigation-only workspace search", () => {
  it.each([["Reports", "/analytics"], ["Connections", "/settings/integrations"], ["Review", "/review"]])(
    "finds %s through the existing catalog", (query, href) => {
      expect(searchDestinations(query, { platformAdmin: false })).toContainEqual(expect.objectContaining({ kind: "page", href }));
    }
  );
  it("never offers platform destinations to tenants or without trusted access context", () => {
    for (const item of NAVIGATION_SECTIONS.filter(section => section.adminOnly).flatMap(section => section.items)) {
      expect(searchDestinations(item.label, { platformAdmin: false }).some(result => result.href === item.href)).toBe(false);
    }
    expect(searchDestinations("Reports")).toEqual([]);
    expect(searchDestinations("Accounts", { platformAdmin: true }).some(result => result.href === "/admin/accounts")).toBe(true);
  });
  it("only returns real navigation destinations, never executable commands or model URLs", () => {
    const catalog = [...NAVIGATION_SECTIONS.flatMap(section => section.items), ...SETTINGS_DESTINATIONS];
    const paths = new Set(catalog.map(item => item.href));
    for (const item of catalog) for (const result of searchDestinations(item.label, { platformAdmin: true })) {
      expect(paths.has(result.href)).toBe(true);
      expect(result.subtitle).toContain("No action is performed");
    }
    for (const query of ["Send now", "Pursue now", "Run scoring-engine", "javascript:alert(1)", "https://example.test"]) {
      expect(searchDestinations(query, { platformAdmin: true })).toEqual([]);
    }
  });
});
