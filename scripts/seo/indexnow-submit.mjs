/**
 * Tell the search engines a page changed, instead of waiting to be asked.
 *
 * A citable resource that is not indexed cannot be found, quoted or linked to.
 * That is the quiet failure in publishing reference material: the page is live,
 * the licence invites reuse, and for six weeks nobody can find it because no
 * crawler has been back. IndexNow closes that gap by pushing -- the site names
 * the URLs that changed and the engines fetch them, usually within minutes.
 *
 * Bing, Yandex, Seznam and Naver share one IndexNow network, so a single
 * submission reaches all of them. Google does not participate; for Google this
 * changes nothing and costs nothing, and the sitemap is what it reads.
 *
 * No account, no API key to buy, no dashboard, nothing to renew. Ownership is
 * proved by the key file at /indexnow-key.txt, which is why this is one of the
 * very few parts of a backlink programme that genuinely runs unattended
 * forever.
 *
 * Usage:
 *   node scripts/seo/indexnow-submit.mjs                 # every public URL
 *   node scripts/seo/indexnow-submit.mjs --only resources
 *   node scripts/seo/indexnow-submit.mjs --url URL...
 *   node scripts/seo/indexnow-submit.mjs --dry-run
 *
 * Exits 0 when the endpoint accepts the batch. A rejection is reported with the
 * status and body, because the interesting failures here are quiet ones: a 403
 * means the key file did not match, and retrying will not fix it.
 */

import { readFileSync } from "node:fs";

const ENDPOINT = "https://api.indexnow.org/IndexNow";

/**
 * Read the public surface out of the declaration the sitemap uses.
 *
 * Parsed from source rather than imported because this is a plain .mjs script
 * and lib/domain/public-routes.ts is TypeScript; a step that needs compiling
 * before it can run is a step that gets skipped.
 *
 * Two shapes have to be read, not one, and this is where a regex over source
 * earns its keep or quietly betrays you. Most routes are literals,
 * `path: "/about"`. The eight contractor guides are not: they are spread in from
 * CONTRACTOR_GUIDES as `path: \`/resources/${guide.slug}\``, so a scan for
 * quoted paths finds the index page and none of the guides. That is the
 * dangerous kind of wrong -- it submits sixteen URLs, looks like it worked, and
 * leaves the eight most citable pages on the site never being pushed.
 *
 * So the guide slugs are read from their own catalog and joined on. The caller
 * cross-checks the result, because the next shape somebody invents will break
 * this again and it must break loudly.
 */
function publicPaths() {
  const source = readFileSync("lib/domain/public-routes.ts", "utf8");
  const start = source.indexOf("export const PUBLIC_ROUTES");
  const end = source.indexOf("export const HOME_SECTIONS", start);
  const block = source.slice(start, end === -1 ? undefined : end);
  const literal = [...block.matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1]);

  const spreadsGuides = /CONTRACTOR_GUIDES\.map/.test(block);
  const guides = spreadsGuides
    ? [...readFileSync("lib/marketing/resources.ts", "utf8").matchAll(/slug:\s*"([^"]+)"/g)].map(
        (m) => `/resources/${m[1]}`,
      )
    : [];
  if (spreadsGuides && !guides.length) {
    throw new Error(
      "PUBLIC_ROUTES spreads CONTRACTOR_GUIDES but no guide slugs were found in lib/marketing/resources.ts; fix the parser rather than submitting an incomplete list.",
    );
  }

  return [...new Set([...literal, ...guides])];
}

/** The key, read from the one place that defines it. */
function indexNowKey() {
  const source = readFileSync("lib/marketing/indexnow.ts", "utf8");
  const match = /INDEXNOW_KEY\s*=\s*"([^"]+)"/.exec(source);
  if (!match) throw new Error("INDEXNOW_KEY not found in lib/marketing/indexnow.ts");
  return match[1];
}

function parseArgs(argv) {
  const opts = { urls: [], only: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--only") opts.only = argv[++i];
    else if (arg === "--url") {
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) opts.urls.push(argv[++i]);
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const siteUrl = (process.env.APP_URL || "https://brostco.com").replace(/\/+$/, "");
  const host = new URL(siteUrl).hostname;
  const key = indexNowKey();

  let urlList = opts.urls.length
    ? opts.urls
    : publicPaths().map((path) => (path === "/" ? siteUrl : `${siteUrl}${path}`));

  if (opts.only) urlList = urlList.filter((u) => u.includes(opts.only));

  /**
   * The register's data distributions, which no page list knows about.
   *
   * They are route handlers rather than pages, so they never appear in
   * PUBLIC_ROUTES, and they are exactly the URLs a catalogue or a reuser
   * fetches. Leaving them out would mean the human page gets recrawled and the
   * machine-readable copy everyone actually consumes goes stale.
   */
  if (!opts.urls.length) {
    const register = `${siteUrl}/resources/idaho-procurement-sources`;
    if (urlList.includes(register)) urlList.push(`${register}/data.json`, `${register}/data.csv`);
  }

  if (!urlList.length) {
    console.error("Nothing to submit: no URLs matched.");
    process.exitCode = 1;
    return;
  }

  console.log(`IndexNow: ${urlList.length} URL(s) for ${host}`);
  for (const url of urlList) console.log(`  ${url}`);

  if (opts.dryRun) {
    console.log("\n--dry-run: nothing submitted.");
    return;
  }

  const body = {
    host,
    key,
    keyLocation: `${siteUrl}/indexnow-key.txt`,
    urlList,
  };

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  const text = await response.text();

  /**
   * 200 and 202 both mean accepted. 422 is the one worth reading closely: it
   * means the URLs did not belong to the host, which is a bug in this script
   * rather than a transient problem, and 403 means the key file did not match.
   * Neither is worth a retry, so they are reported rather than swallowed.
   */
  if (response.status === 200 || response.status === 202) {
    console.log(`\nAccepted (HTTP ${response.status}).`);
    return;
  }
  console.error(`\nRejected: HTTP ${response.status} ${text.slice(0, 400)}`);
  if (response.status === 403) {
    console.error(
      `The key file did not match. Check that ${siteUrl}/indexnow-key.txt serves exactly "${key}".`,
    );
  }
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
