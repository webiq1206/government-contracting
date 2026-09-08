import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("opportunity monitor partial failures", () => {
  it("returns scraper failure counts instead of an indistinguishable empty array", () => {
    const source = readFileSync("lib/integrations/scrapers/index.ts", "utf8");
    expect(source).toContain("export interface ScraperRunResult");
    expect(source).toContain("failures++");
    expect(source).toContain("return { opportunities: all, failures, enabled: true }");
  });

  it("does not hide scraper or scoring queue failures", () => {
    const source = readFileSync("lib/agents/opportunity-monitor.ts", "utf8");
    expect(source).not.toContain("runEnabledScrapers(naics).catch(() => [])");
    expect(source).not.toContain("enqueue scoring failed");
    expect(source).toContain('action: "scoring-not-queued"');
    expect(source).toContain("scraperFailures === 0");
    expect(source).toContain("humanActionRequired:");
  });
});
