import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("closed-opportunity work cleanup", () => {
  it("clears follow-ups and pending calls in one tenant-scoped transaction", () => {
    const source = readFileSync("lib/close-opportunity-work.ts", "utf8");
    expect(source).toContain("client ? await clean(client) : await transaction(clean)");
    expect(source).toMatch(/update communications[\s\S]*where org_id = \$1/);
    expect(source).toMatch(/update call_cards[\s\S]*where org_id = \$1/);
    expect(source).not.toContain(".catch(() => {})");
  });

  it("archives a passed opportunity and stops its queued work in the same transaction", () => {
    const source = readFileSync("lib/opportunity-transitions.ts", "utf8");
    const pass = source.slice(
      source.indexOf("export async function passOpportunity"),
      source.indexOf("export async function moveOpportunity")
    );
    expect(pass).toContain("transaction(async (client)");
    expect(pass).toContain('stopOpportunityAutomation(orgId, [id], "passed", client)');
  });
});
