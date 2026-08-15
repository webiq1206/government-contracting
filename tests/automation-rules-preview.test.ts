import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The Automation Rules preview counts must be scoped to one organization.
 *
 * Static, for the same reason tests/data-scoping.test.ts is: the mistake this
 * guards is not subtle logic, it is a query that simply never mentions org_id.
 * Three of these four counts shipped that way, so the settings page told every
 * customer how many past-due opportunities the whole platform had and called
 * it theirs, and the retention line claimed to preview what the sweep would
 * delete while counting records that sweep would never touch on this
 * customer's window. A runtime test would need a seeded two-tenant database
 * and would still only cover the counts someone remembered to exercise.
 */

const SRC = readFileSync(
  join(process.cwd(), "app/api/automation/rules/route.ts"),
  "utf8"
);

/** Every SQL template literal in the file that reads a tenant-owned table. */
function tenantQueries(): string[] {
  const literals = SRC.match(/`[^`]*`/g) ?? [];
  return literals.filter(
    (sql) =>
      /\bselect\b/i.test(sql) &&
      /\b(from|join)\s+(opportunities|call_cards|subcontractors|quotes|bids|contracts)\b/.test(
        sql
      )
  );
}

describe("automation rules preview counts", () => {
  it("finds the queries it is supposed to be checking", () => {
    // A guard on the guard: if the extraction stops matching, every assertion
    // below would vacuously pass.
    expect(tenantQueries().length).toBeGreaterThanOrEqual(4);
  });

  it("scopes every count to one organization", () => {
    const unscoped = tenantQueries().filter((sql) => !/org_id/.test(sql));
    expect(
      unscoped,
      `These preview counts read tenant tables without an org_id filter, so ` +
        `they report every organization's records to whoever opens Settings:\n` +
        unscoped.map((s) => `  ${s.trim().slice(0, 120)}…`).join("\n")
    ).toEqual([]);
  });

  it("returns zeros rather than platform-wide totals when no org resolves", () => {
    expect(SRC).toMatch(/if \(!orgId\) return EMPTY_PREVIEW;/);
  });
});
