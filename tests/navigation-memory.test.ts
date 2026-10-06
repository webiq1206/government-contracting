import { describe, expect, it } from "vitest";
import { safeWorkspaceReturn } from "@/components/navigation-memory";

describe("workspace return destinations", () => {
  it.each([
    "/review?o=selected", "/pipeline?stage=outreach&q=repair&page=2",
    "/recap?date=2026-10-05#follow-up", "/compliance?state=missing",
    "/activity?area=outreach", "/communications/history?contact=sub-1&project=opp-1",
    "/subs/00000000-0000-0000-0000-000000000001?tab=opportunities#pairings",
  ])("retains the originating filters and selection: %s", href => {
    expect(safeWorkspaceReturn(href)).toBe(href);
  });
  it.each(["https://example.com", "//example.com", "/\\example.com", "/api/admin/delete", "/unknown", "/pipeline\n"]) (
    "rejects unsafe or unrecognized destinations: %s", href => {
      expect(safeWorkspaceReturn(href)).toBeNull();
    },
  );
});
