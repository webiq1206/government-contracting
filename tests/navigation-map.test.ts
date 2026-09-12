import { describe, it, expect } from "vitest";
import {
  NAVIGATION_SECTIONS,
  SETTINGS_DESTINATIONS,
  navigationMatches,
  mobileDestination,
} from "../lib/navigation";
import { existsSync } from "node:fs";

describe("shared navigation destinations", () => {
  it("includes activity and usage in the same source on every device", () => {
    const links = NAVIGATION_SECTIONS.flatMap((section) => section.items.map((item) => item.href));
    expect(links).toContain("/activity");
    expect(links).toContain("/admin/api-usage");
    expect(SETTINGS_DESTINATIONS.some((item) => item.href === "/settings/api-usage")).toBe(true);
    expect(new Set(links).size).toBe(links.length);
    for (const href of links) {
      expect(
        ["app/(dash)", "app/(account)"].some((root) => existsSync(`${root}${href}/page.tsx`)),
        href
      ).toBe(true);
    }
  });

  it.each([
    ["/opportunity/abc", "/pipeline"],
    ["/opportunity/abc/requirements", "/pipeline"],
    ["/subs/abc", "/subs"],
    ["/communications", "/communications"],
    ["/call-queue", "/workbench"],
    ["/settings/api-usage", "/settings/profile"],
    ["/admin/accounts/abc", "/settings/profile"],
    ["/activity", "/settings/profile"],
  ])("maps legacy mobile destination %s to %s", (path, expected) => {
    expect(mobileDestination(path)).toBe(expected);
  });

  it("matches record families without matching unrelated prefixes", () => {
    expect(navigationMatches("/opportunity/abc", "/pipeline")).toBe(true);
    expect(navigationMatches("/subscribers", "/subs")).toBe(false);
    expect(navigationMatches("/settings/api-usage", "/settings/account")).toBe(false);
  });

  it("does not expose owner tools through tenant groups", () => {
    const visible = NAVIGATION_SECTIONS.filter((section) => !section.adminOnly).flatMap(
      (section) => section.items
    );
    expect(
      visible.some((item) => item.href.startsWith("/admin/") || item.href === "/authority")
    ).toBe(false);
  });
});
