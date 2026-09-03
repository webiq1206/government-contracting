import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  AI_CRAWLERS,
  DISALLOWED_PREFIXES,
  HOME_SECTIONS,
  PUBLIC_ROUTES,
  absoluteUrl,
  crawlability,
} from "@/lib/domain/public-routes";

/**
 * What makes the crawl path live rather than a snapshot of one.
 *
 * Four surfaces have to agree about which pages a crawler may have -- the XML
 * sitemap, robots.txt, the HTML site map and llms.txt -- and before this they
 * were three hand-written lists and nothing. `app/sitemap.ts` named four URLs;
 * `app/robots.ts` disallowed thirteen prefixes while the application had grown
 * to sixty-three page routes, twenty-one of them signed-in and uncovered.
 * Neither list could tell anybody it had gone stale, which is the whole
 * problem: a sitemap that silently omits a page looks exactly like a sitemap
 * that is complete.
 *
 * So the test that matters is the first one. It walks the app directory and
 * fails on a route that is neither declared public nor covered by a disallow
 * rule, which means a new page cannot be added without the declaration being
 * brought along. The rest check that the four surfaces really do read from it.
 */

const APP = "app";

/** Every page.tsx under app/, as a route path with route groups removed. */
function routes(dir: string, prefix = "", out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "api") continue;
      // (dash) and (marketing) are route groups: they organize files, not URLs.
      const segment = entry.startsWith("(") && entry.endsWith(")") ? "" : `/${entry}`;
      routes(full, prefix + segment, out);
    } else if (entry === "page.tsx") {
      out.push(prefix === "" ? "/" : prefix);
    }
  }
  return out;
}

describe("every page is classified", () => {
  it("leaves no route neither public nor disallowed", () => {
    /*
     * The guard. An unclassified route is a page that will be crawled without
     * anybody having decided it should be, or a public page that never reaches
     * the sitemap. Both were true of this app before the declaration existed.
     */
    const unclassified = routes(APP).filter((r) => crawlability(r) === "unclassified");
    expect(
      unclassified,
      "add these to PUBLIC_ROUTES or DISALLOWED_PREFIXES in lib/domain/public-routes.ts"
    ).toEqual([]);
  });

  it("finds the routes it claims to walk", () => {
    /*
     * Guards the guard. A walk that returned nothing would make the assertion
     * above pass forever, which is the failure mode a directory-scanning test
     * is most prone to.
     */
    const all = routes(APP);
    expect(all.length).toBeGreaterThan(50);
    expect(all).toContain("/");
    expect(all).toContain("/sitemap");
    expect(all).toContain("/today");
  });

  it("agrees with itself about the public pages", () => {
    for (const route of PUBLIC_ROUTES) {
      expect(crawlability(route.path), route.path).toBe("public");
    }
    // And a signed-in page is never public, whatever else changes.
    for (const route of ["/today", "/admin", "/settings/profile", "/theme-qa"]) {
      expect(crawlability(route), route).toBe("disallowed");
    }
  });

  it("has a real page behind every public entry", () => {
    // A sitemap entry for a page that does not exist is a 404 advertised to
    // crawlers.
    const all = new Set(routes(APP));
    for (const route of PUBLIC_ROUTES) {
      expect(all.has(route.path), `${route.path} has no page.tsx`).toBe(true);
    }
  });
});

describe("the declaration itself", () => {
  it("gives every page a distinct path and a summary worth reading", () => {
    const paths = PUBLIC_ROUTES.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const r of PUBLIC_ROUTES) {
      expect(r.label.trim().length, r.path).toBeGreaterThan(0);
      // Long enough to say what the page is for. A one-word summary on an
      // HTML site map is the same as no summary.
      expect(r.summary.trim().length, r.path).toBeGreaterThan(40);
      expect(r.priority, r.path).toBeGreaterThan(0);
      expect(r.priority, r.path).toBeLessThanOrEqual(1);
    }
  });

  it("builds absolute URLs without a doubled or missing slash", () => {
    expect(absoluteUrl("https://brostco.com", "/")).toBe("https://brostco.com");
    expect(absoluteUrl("https://brostco.com/", "/")).toBe("https://brostco.com");
    expect(absoluteUrl("https://brostco.com", "/terms")).toBe("https://brostco.com/terms");
    expect(absoluteUrl("https://brostco.com/", "/terms")).toBe("https://brostco.com/terms");
  });

  it("says why each prefix is disallowed", () => {
    // The reason decides what happens when somebody adds a route beside it,
    // so a rule without one is a rule nobody can maintain.
    for (const d of DISALLOWED_PREFIXES) {
      expect(d.why.trim().length, d.prefix).toBeGreaterThan(10);
      expect(d.prefix.startsWith("/"), d.prefix).toBe(true);
    }
  });

  it("keeps home-page sections out of the page list", () => {
    // A fragment is the same document to a crawler. Listing them as URLs
    // would claim several pages where there is one.
    for (const s of HOME_SECTIONS) {
      expect(s.hash.startsWith("#"), s.hash).toBe(true);
      expect(PUBLIC_ROUTES.some((r) => r.path === s.hash)).toBe(false);
    }
  });
});

describe("the four surfaces read from the declaration", () => {
  const read = (f: string) => readFileSync(f, "utf8");

  it("sitemap.xml is generated, not typed out", () => {
    const src = read("app/sitemap.ts");
    expect(src).toContain("PUBLIC_ROUTES");
    expect(src).toContain("absoluteUrl");
    // The shape of the defect being fixed: a literal marketing URL in the
    // file means somebody has started hand-maintaining it again.
    expect(src).not.toMatch(/url:\s*`?\$?\{?SITE_URL\}?\/(signup|privacy|terms)/);
  });

  it("robots.txt is generated, and names the AI crawlers one at a time", () => {
    const src = read("app/robots.ts");
    expect(src).toContain("allowedPaths()");
    expect(src).toContain("disallowedPaths()");
    expect(src).toContain("AI_CRAWLERS");
    // Left to the wildcard, a cautious AI crawler can decline to fetch at all.
    expect(AI_CRAWLERS).toContain("GPTBot");
    expect(AI_CRAWLERS).toContain("ClaudeBot");
    expect(AI_CRAWLERS).toContain("PerplexityBot");
    expect(new Set(AI_CRAWLERS).size).toBe(AI_CRAWLERS.length);
  });

  it("the HTML site map is generated, and its links are real anchors", () => {
    const src = read("app/(marketing)/sitemap/page.tsx");
    expect(src).toContain("PUBLIC_ROUTES.filter");
    expect(src).toContain("href={route.path}");
    // Server-rendered: no client directive, so the list is in the first
    // response for a crawler that runs no JavaScript.
    expect(src).not.toContain('"use client"');
    // And it carries the machine-readable siblings, which is how a crawler
    // that lands here finds them.
    expect(src).toContain('href="/sitemap.xml"');
    expect(src).toContain('href="/llms.txt"');
  });

  it("llms.txt is generated, and states the limits", () => {
    const src = read("app/llms.txt/route.ts");
    expect(src).toContain("PUBLIC_ROUTES");
    // The section that keeps an answer engine from claiming the product
    // submits bids, which it does not.
    expect(src).toContain("What it does not do");
    expect(src).toContain("does not submit bids");
    expect(src).toContain("text/plain");
  });

  it("the site map is linked from the marketing footer, so it is not an orphan", () => {
    // A site map nothing links to is reachable only by guessing its address.
    expect(read("components/marketing/marketing-footer.tsx")).toContain('href="/sitemap"');
  });
});
