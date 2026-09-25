/**
 * Ahrefs ledger rows are keyed by a stable service name, not an endpoint path.
 *
 * With the path as the key, an administrator had to enter one price ceiling
 * per URL, and a new endpoint broke the scout again. With a name per
 * endpoint, one row per service is enough and the key survives a URL change.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { AHREFS_SERVICES } from "@/lib/integrations/ahrefs";

describe("Ahrefs service names", () => {
  it("names every endpoint the client calls", () => {
    const src = readFileSync("lib/integrations/ahrefs.ts", "utf8");
    const called = Array.from(src.matchAll(/"(\/site-explorer\/[a-z-]+)"/g)).map((m) => m[1]);
    expect(called.length).toBeGreaterThan(0);
    for (const path of new Set(called)) {
      expect(AHREFS_SERVICES, path).toHaveProperty(path);
    }
  });

  it("uses the same shape as the other metered integrations", () => {
    for (const name of Object.values(AHREFS_SERVICES)) {
      expect(name).toMatch(/^[A-Z_]+$/);
    }
    expect(new Set(Object.values(AHREFS_SERVICES)).size).toBe(Object.keys(AHREFS_SERVICES).length);
  });

  it("meters by the name, and asks the ledger before the first scan call", () => {
    const client = readFileSync("lib/integrations/ahrefs.ts", "utf8");
    expect(client).toContain("service: AHREFS_SERVICES[path]");
    expect(client).not.toContain("service: path");
    const scout = readFileSync("lib/agents/backlink-scout.ts", "utf8");
    const preflight = scout.indexOf("ahrefs.admissionHold(orgId)");
    const firstCall = scout.indexOf("ahrefs.authoritySnapshot(target)");
    expect(preflight).toBeGreaterThan(-1);
    expect(firstCall).toBeGreaterThan(preflight);
    expect(scout).toContain('action: "spending-held"');
    expect(scout).toContain("spendingHeld: true");
  });
});
