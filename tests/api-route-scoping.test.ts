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
 * Known unscoped routes this guard is pinned against. NOT exemptions: an entry
 * here is a bug, listed so the check can run today and refuse the next one
 * rather than being deleted until someone has time.
 *
 * Empty, and meant to stay that way. Shrink this list. Do not grow it.
 */
const KNOWN_UNSCOPED = new Set<string>([]);

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

/**
 * Naming the column, or handing the lookup to the org guard's findOrgRecord,
 * which does the scoping for you. requireOrgContext deliberately does not
 * count: it resolves the organization, it does not apply it.
 */
function isScoped(r: Route): boolean {
  return /org_id|findOrgRecord/.test(r.src);
}

/**
 * Checked per file, but the escape hatch is narrow on purpose.
 *
 * The first cut passed any file that merely mentioned requireOrgContext, and
 * that is not scoping: resolving the caller's organization and then querying
 * without it is precisely the bug this exists to catch. Stripping org_id out
 * of a fixed route sailed through it. So requireOrgContext no longer counts;
 * a route has to name org_id or use findOrgRecord.
 *
 * A per-statement rule was tried next and is too strict to be useful here:
 * these routes prove ownership once with a scoped lookup, 404 if it misses,
 * then act on the verified id, so their later statements legitimately carry no
 * org_id. That means this check is a floor, not a proof. It catches the route
 * that never scopes anything, which is the shape every instance of this bug
 * has taken so far. It cannot catch a route that scopes one query and forgets
 * another; only reading the route can.
 */
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
      .filter((r) => !isScoped(r))
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
        .filter((r) => !isScoped(r))
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

/**
 * Server components read tenant tables too, and the same bug reached them by
 * a different door: the Content Library page selected templates with no org
 * filter, so the tenant with the most saved versions supplied everyone
 * else's editor, and the Profile page listed every tenant's pending scoring
 * proposals. Pages that import the db module directly get the same floor as
 * API routes: name org_id somewhere, or fetch through the scoped helpers in
 * lib/data.ts and friends instead.
 */
describe("pages that query tenant tables directly", () => {
  const APP_DIR = join(process.cwd(), "app");

  function pageFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) pageFiles(full, acc);
      else if (entry === "page.tsx") acc.push(full);
    }
    return acc;
  }

  it("every page importing lib/db names org_id", () => {
    const offenders = pageFiles(APP_DIR)
      .map((path) => ({
        rel: path.slice(process.cwd().length + 1),
        src: readFileSync(path, "utf8"),
      }))
      .filter((p) => /from ["']@\/lib\/db["']/.test(p.src))
      .filter((p) => TABLE_RE.test(p.src))
      .filter((p) => !/org_id/.test(p.src));
    expect(
      offenders.map((o) => o.rel),
      "these pages query tenant tables without naming org_id"
    ).toEqual([]);
  });
});
