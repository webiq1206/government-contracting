import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The accessibility sweep must not report on a smaller product than shipped.
 *
 * scripts/a11y-sweep.ts drives a real browser over a hand-written list of
 * routes. It printed "0 findings" for months while four pages added in that
 * time were not in the list at all, and when they were added it found
 * fourteen touch targets under 44px on one of them. A zero that covers less
 * than the product is worse than a number nobody trusts, because this one does
 * get trusted.
 *
 * So every operator page must either be swept or be named here with a reason.
 * Adding a page and forgetting the sweep is now a failing test rather than a
 * silently narrower report.
 */

const APP = "app";

/** Routes deliberately not swept, each with the reason it cannot be. */
const EXEMPT = new Map<string, string>([
  ["/", "Marketing home, outside the operator shell."],
  ["/login", "Signed out. The sweep signs in before it measures."],
  ["/signup", "Signed out."],
  ["/setup", "Signed out, and only reachable on a fresh install."],
  ["/forgot-password", "Signed out."],
  ["/reset-password", "Signed out, and needs a live token."],
  ["/invite", "Signed out, and needs a live invitation token."],
  ["/billing/success", "Post-checkout confirmation; needs a live Stripe session."],
  ["/vendor/[token]", "The subcontractor's own upload page, outside the operator shell."],
  ["/privacy", "Static legal copy."],
  // Redirects, not pages. The sweep would measure the destination while
  // labelling the finding with the old address, which reads as a defect on a
  // page that does not exist.
  ["/settings", "Redirects to /settings/profile, which is swept."],
  ["/email-log", "Redirects to /communications, which is swept."],
  ["/terms", "Static legal copy."],
  // Record pages need a live id, which the sweep has no way to choose without
  // reaching into the database. Their layout is exercised by the pages above
  // that link to them, and by the per-piece browser probes.
  ["/opportunity/[id]", "Needs a record id."],
  ["/subs/[id]", "Needs a record id."],
  ["/contracts/[id]", "Needs a record id."],
  ["/admin/accounts/[id]", "Needs a record id."],
]);

/** Every page.tsx under app/, as a route path with the route groups removed. */
function routes(dir: string, prefix = "", out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "api") continue;
      // (dash) and (account) are route groups: they organize files, not URLs.
      const segment = entry.startsWith("(") && entry.endsWith(")") ? "" : `/${entry}`;
      routes(full, prefix + segment, out);
    } else if (entry === "page.tsx") {
      out.push(prefix === "" ? "/" : prefix);
    }
  }
  return out;
}

function sweptRoutes(): string[] {
  const src = readFileSync("scripts/a11y-sweep.ts", "utf8");
  const block = src.slice(src.indexOf("const ROUTES = ["), src.indexOf("];", src.indexOf("const ROUTES = [")));
  return [...block.matchAll(/"(\/[^"]*)"/g)].map((m) => m[1]);
}

describe("the accessibility sweep covers the product", () => {
  it("sweeps every operator page, or says why not", () => {
    const swept = new Set(sweptRoutes());
    const missing = routes(APP)
      .filter((r) => !swept.has(r))
      .filter((r) => !EXEMPT.has(r))
      // A palette harness for developers rather than a page any operator
      // reaches, and there are a dozen of them.
      .filter((r) => !r.startsWith("/theme-qa"));
    expect(missing).toEqual([]);
  });

  it("does not sweep a route that no longer exists", () => {
    const all = new Set(routes(APP));
    for (const r of sweptRoutes()) expect(all.has(r), r).toBe(true);
  });

  it("does not exempt a route that no longer exists", () => {
    const all = new Set(routes(APP));
    for (const r of EXEMPT.keys()) expect(all.has(r), r).toBe(true);
  });
});
