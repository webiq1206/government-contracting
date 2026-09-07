import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("provider prerequisite read failures", () => {
  it("does not bypass email suppression when tenant resolution fails", () => {
    const source = readFileSync("lib/integrations/email-transport.ts", "utf8");
    expect(source).toContain("await tryResolveTenantOrgId()");
    expect(source).not.toContain("tryResolveTenantOrgId().catch(() => null)");
  });

  it("does not report zero SAM usage when its ledger query fails", () => {
    const source = readFileSync("lib/integrations/sam.ts", "utf8");
    const usage = source.slice(source.indexOf("export async function samDailyUsage"));
    expect(usage).not.toMatch(/queryOne<[\s\S]*?>\([\s\S]*?\)\.catch\(\(\) => null\)/);
    expect(usage).toContain("A failed query throws");
  });
});
