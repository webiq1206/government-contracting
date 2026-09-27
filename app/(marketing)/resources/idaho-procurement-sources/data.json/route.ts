import {
  PROCUREMENT_SOURCES,
  lastVerifiedOn,
} from "@/lib/marketing/procurement-sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The procurement register as JSON.
 *
 * A register is only reused if reusing it is easier than rebuilding it. Offered
 * as a document a person can quote and as data a person can load, because the
 * two audiences that link to something like this want different things: a
 * counsellor wants a page to point a client at, and whoever maintains that
 * organization's own resource list wants the rows without writing a scraper.
 *
 * Deliberately open, with no key and no rate limit: seven rows of public-sector
 * URLs are not worth gating, and a gate is the thing that stops it being cited.
 *
 * The envelope carries the licence terms and the citation with the data rather
 * than only on the page, so a copy that has travelled still says where it came
 * from and how stale it is.
 */
export async function GET() {
  const site = (process.env.APP_URL || "https://brostco.com").replace(/\/$/, "");
  const canonical = `${site}/resources/idaho-procurement-sources`;

  const body = {
    name: "Idaho public procurement sources, by buying authority",
    description:
      "Which Idaho authority advertises which public work, on which official source, and what each source leaves out.",
    canonical,
    publisher: { name: "BrostCo", url: site },
    lastVerifiedOn: lastVerifiedOn(),
    terms:
      "Free to quote, link to and build on, including commercially. Attribution requested, naming BrostCo and the canonical URL, so readers can reach the current version.",
    citation: `BrostCo. "Idaho public procurement sources, by buying authority." Last checked ${lastVerifiedOn()}. ${canonical}`,
    disclaimer:
      "Points to official sources; not legal or procurement advice. Each authority's own page is the system of record for its opportunities, requirements and deadlines.",
    count: PROCUREMENT_SOURCES.length,
    sources: PROCUREMENT_SOURCES,
  };

  return new Response(`${JSON.stringify(body, null, 2)}\n`, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Cheap to regenerate and rarely changes, but a stale copy in somebody
      // else's cache is the failure mode this register cannot afford.
      "cache-control": "public, max-age=3600",
      "access-control-allow-origin": "*",
    },
  });
}
