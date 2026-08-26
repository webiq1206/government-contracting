import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Every surface that shows setup progress must go through accountSetup.
 *
 * There were four callers of computeSetupChecklist and they did not agree.
 * Today mixed the deployment's environment keys with the customer's own and
 * passed the trial flag; both Guide Me routes read the environment alone and
 * passed neither. On a trial account with its own SAM key, Today said the step
 * was done and the Guide Me panel on the same screen listed it as outstanding.
 *
 * The domain function stays exported and unit-tested on its own; what this
 * guards is that no page or route calls it directly again and reintroduces a
 * second opinion.
 */
const SURFACES = [
  "app/(dash)/today/page.tsx",
  "app/(dash)/how-it-works/page.tsx",
  // The Guide Me panel and its Q&A both stand on this one loader.
  "lib/guide/load.ts",
  "app/api/guide/pulse/route.ts",
];

describe("one answer to how far setup has got", () => {
  for (const file of SURFACES) {
    it(`${file} reads it through accountSetup`, () => {
      const text = readFileSync(file, "utf8");
      expect(text).toContain("accountSetup");
      expect(text).not.toContain("computeSetupChecklist");
    });
  }

  it("only the helper and its own tests build the checklist directly", () => {
    const helper = readFileSync("lib/setup-facts.ts", "utf8");
    expect(helper).toContain("computeSetupChecklist");
    // The two facts the callers kept getting wrong.
    expect(helper).toContain("orgIntegrationStatus");
    expect(helper).toContain("onTrial");
  });
});
