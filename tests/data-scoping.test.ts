import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every read in the data layer must be scoped to one organization.
 *
 * This is a static check rather than a database test on purpose. The bug it
 * guards against was not a subtle logic error: it was twenty-two functions
 * that simply never mentioned org_id, so every list page in the product showed
 * every tenant's rows. A brand-new customer's first page load listed another
 * company's subcontractors and contracts.
 *
 * A runtime test would need a seeded two-tenant database and would still only
 * cover the functions someone remembered to exercise. Reading the source
 * catches the next function too, on the day it is written, which is the only
 * time this class of mistake is cheap to fix.
 */

const SRC = readFileSync(join(process.cwd(), "lib/data.ts"), "utf8");

/** Tables that belong to exactly one organization. */
const TENANT_TABLES = [
  "subcontractors",
  "opportunities",
  "contracts",
  "quotes",
  "bids",
  "call_cards",
  "communications",
  "compliance_items",
  "content_library",
  "custom_kpis",
  "documents",
  "pricing_comps",
  "agent_logs",
];

interface Fn {
  name: string;
  body: string;
}

function exportedFunctions(): Fn[] {
  const parts = SRC.split(/\nexport (?:async )?function /);
  return parts.slice(1).map((part) => ({
    name: part.split(/[(<]/)[0].trim(),
    body: part,
  }));
}

function touchesTenantTable(body: string): string[] {
  return TENANT_TABLES.filter((t) =>
    new RegExp(String.raw`\b(from|join|into|update)\s+${t}\b`).test(body)
  );
}

describe("tenant scoping in the data layer", () => {
  it("finds the functions it is supposed to be checking", () => {
    // A guard on the guard: if the parser stops matching (a refactor to arrow
    // exports, say), every assertion below would vacuously pass.
    const fns = exportedFunctions();
    expect(fns.length).toBeGreaterThan(15);
    expect(fns.filter((f) => touchesTenantTable(f.body).length > 0).length).toBeGreaterThan(10);
  });

  it("scopes every function that reads a tenant-owned table", () => {
    const unscoped = exportedFunctions()
      .filter((f) => touchesTenantTable(f.body).length > 0)
      .filter((f) => !/org_id/.test(f.body))
      .map((f) => `${f.name} (reads ${touchesTenantTable(f.body).join(", ")})`);

    expect(
      unscoped,
      `These read tenant tables without an org_id filter, so they return every ` +
        `organization's rows:\n  ${unscoped.join("\n  ")}\n`
    ).toEqual([]);
  });
});
