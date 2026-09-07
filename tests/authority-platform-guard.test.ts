import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("Site Authority remains platform-only and tenant-scoped", () => {
  it("hides the page and both mutation routes from customer accounts", () => {
    expect(read("app/(dash)/authority/page.tsx")).toContain("isPlatformAdmin");
    for (const route of [
      "app/api/authority/draft/route.ts",
      "app/api/authority/outreach/[id]/route.ts",
    ]) {
      const src = read(route);
      expect(src, route).toContain("requirePlatformAdmin");
      expect(src, route).toContain("LEGACY_ORG_ID");
      expect(src, route).toContain("runWithOrg(orgId");
    }
  });

  it("does not expose the platform scout through the generic customer run endpoint", () => {
    const src = read("app/api/agents/[name]/run/route.ts");
    expect(src).toContain('def.name === "backlink-scout"');
    expect(src).toContain("!isPlatformAdmin(auth.email)");
    expect(src).toContain('{ error: "Not found" }');
  });
});
