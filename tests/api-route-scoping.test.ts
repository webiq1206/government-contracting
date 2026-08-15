import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Every API route that reads a tenant-owned table must scope it.
 *
 * The sibling guard (tests/data-scoping.test.ts) reads lib/data.ts only, and
 * the same bug walked straight around it: the Settings preview counts, the
 * Today pulse, and both Guide endpoints each queried tenant tables directly
 * with no org filter, so they answered with the whole platform's numbers and,
 * in the Guide's case, with the stage of any opportunity UUID handed to it.
 *
 * Static, for the reason the sibling gives: this class of mistake is a query
 * that never mentions org_id, and reading the source catches the next one on
 * the day it is written.
 */

const API_DIR = join(process.cwd(), "app/api");

/** Tables that belong to exactly one organization. */
const TENANT_TABLES = [
  "subcontractors",
  "opportunities",
  "opportunity_subs",
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
  "scoring_weights",
  "backlink_outreach",
];

/**
 * Routes that read a tenant table without an organization, on purpose.
 *
 * Both are the outbound-email tracking pixels. They are opened by a
 * subcontractor's mail client, not by a signed-in user, so there is no session
 * to scope by; the row is addressed by an unguessable tracking id, which is
 * the only credential such a request can carry. Anything added here needs the
 * same kind of argument written down next to it.
 */
const EXEMPT = new Set([
  "app/api/track/open/[id]/route.ts",
  "app/api/track/click/[id]/route.ts",
]);

/**
 * Known unscoped routes this guard is pinned against. NOT exemptions: these
 * are bugs, listed so the check can run today and refuse the next one, rather
 * than being deleted until someone has time for them.
 *
 *   scoring-weights approve - takes a proposal id from any organization, and
 *     `update scoring_weights set is_active=false where is_active=true`
 *     deactivates every organization's active rubric, not just the caller's.
 *   authority draft - reads a prospect by bare id and writes the outreach row
 *     with no organization, so the draft lands outside the approvals list it
 *     was meant to appear in.
 *
 * Shrink this list. Do not grow it.
 */
const KNOWN_UNSCOPED = new Set([
  "app/api/scoring-weights/[id]/approve/route.ts",
  "app/api/authority/draft/route.ts",
]);

function routeFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) routeFiles(full, acc);
    else if (entry === "route.ts") acc.push(full);
  }
  return acc;
}

const TABLE_RE = new RegExp(
  String.raw`\b(from|join|into|update)\s+(${TENANT_TABLES.join("|")})\b`
);

interface Route {
  rel: string;
  src: string;
  tables: string[];
}

function routesTouchingTenantTables(): Route[] {
  return routeFiles(API_DIR)
    .map((path) => {
      const src = readFileSync(path, "utf8");
      const rel = path.slice(process.cwd().length + 1);
      const tables = TENANT_TABLES.filter((t) =>
        new RegExp(String.raw`\b(from|join|into|update)\s+${t}\b`).test(src)
      );
      return { rel, src, tables };
    })
    .filter((r) => r.tables.length > 0);
}

describe("tenant scoping in API routes", () => {
  it("finds the routes it is supposed to be checking", () => {
    // A guard on the guard: if the walk or the table regex stops matching,
    // every assertion below would vacuously pass.
    expect(TABLE_RE.test("from opportunities")).toBe(true);
    expect(routesTouchingTenantTables().length).toBeGreaterThan(10);
  });

  it("scopes every route that reads a tenant-owned table", () => {
    const unscoped = routesTouchingTenantTables()
      .filter((r) => !EXEMPT.has(r.rel) && !KNOWN_UNSCOPED.has(r.rel))
      // findOrgRecord / requireOrgContext scope through lib/org-guard rather
      // than by naming the column in this file.
      .filter(
        (r) => !/org_id|findOrgRecord|requireOrgContext|currentOrg/.test(r.src)
      )
      .map((r) => `${r.rel} (reads ${r.tables.join(", ")})`);

    expect(
      unscoped,
      `These API routes read tenant tables without scoping them to one ` +
        `organization, so they answer with every organization's rows:\n  ${unscoped.join(
          "\n  "
        )}\n`
    ).toEqual([]);
  });

  it("keeps the exemption list honest", () => {
    // An exemption for a route that no longer exists (or no longer reads a
    // tenant table) is a hole waiting for the next file of that name.
    const touching = new Set(routesTouchingTenantTables().map((r) => r.rel));
    for (const rel of EXEMPT) {
      expect(touching.has(rel), `${rel} is exempted but no longer needs to be`).toBe(
        true
      );
    }
  });

  it("drops a known-unscoped route from the list once it is fixed", () => {
    // The list is a ratchet: fixing one of these must remove it here, or the
    // route silently keeps its licence to regress.
    const stillUnscoped = new Set(
      routesTouchingTenantTables()
        .filter(
          (r) => !/org_id|findOrgRecord|requireOrgContext|currentOrg/.test(r.src)
        )
        .map((r) => r.rel)
    );
    for (const rel of KNOWN_UNSCOPED) {
      expect(
        stillUnscoped.has(rel),
        `${rel} is scoped now, so remove it from KNOWN_UNSCOPED`
      ).toBe(true);
    }
  });
});
