/**
 * Tell the search engines a page changed, instead of waiting to be asked.
 *
 * A citable resource that is not indexed cannot be found, quoted or linked to.
 * That is the quiet failure in publishing reference material: the page is live,
 * the licence invites reuse, and for weeks nobody can find it because no crawler
 * has been back. IndexNow closes that gap by pushing -- the site names the URLs
 * that changed and the engines fetch them, usually within minutes.
 *
 * Bing, Yandex, Seznam and Naver share one IndexNow network, so a single
 * submission reaches all of them. Google does not participate; for Google this
 * changes nothing and costs nothing, and the sitemap is what it reads.
 *
 * No account, no API key to buy, nothing to renew. Ownership is proved by the key
 * file at /indexnow-key.txt, which is why this is one of the very few parts of a
 * backlink programme that runs unattended permanently.
 *
 * TypeScript, and run with `node --import tsx`, for one reason that matters.
 *
 * The first version was a .mjs script that found the public routes by regexing
 * lib/domain/public-routes.ts for `path: "..."`. That worked until it didn't:
 * most routes are literals, but whole sections are spread in from catalogs as
 * `path: \`/tools/${tool.slug}\``, and a scan for quoted paths silently returns
 * the index pages and none of their children. It shipped submitting sixteen URLs
 * of twenty-six, looked successful, and omitted the most citable pages on the
 * site. A guard was added for the one catalog that existed -- and then two more
 * catalogs arrived and it under-counted again.
 *
 * Importing the declaration ends that class of bug permanently. Whatever the app
 * says is public is what gets submitted, however it is expressed, including
 * catalogs nobody has invented yet.
 *
 * Usage:
 *   node --import tsx scripts/seo/indexnow-submit.ts
 *   node --import tsx scripts/seo/indexnow-submit.ts --dry-run
 *   node --import tsx scripts/seo/indexnow-submit.ts --only resources
 *   node --import tsx scripts/seo/indexnow-submit.ts --url https://...
 */

import { PUBLIC_ROUTES, absoluteUrl } from "../../lib/domain/public-routes";
import { INDEXNOW_KEY } from "../../lib/marketing/indexnow";

const ENDPOINT = "https://api.indexnow.org/IndexNow";

/**
 * Public URLs that are route handlers rather than pages.
 *
 * They never appear in PUBLIC_ROUTES, because that declares the pages a crawler
 * may index and these are files it fetches. They are also exactly what a
 * catalogue or a reuser consumes, so leaving them out would mean the human page
 * gets recrawled while the machine-readable copy everyone actually reads goes
 * stale.
 */
const EXTRA_PATHS = [
  "/resources/idaho-procurement-sources/data.json",
  "/resources/idaho-procurement-sources/data.csv",
];

interface Options {
  urls: string[];
  only: string | null;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { urls: [], only: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--only") opts.only = argv[++i] ?? null;
    else if (arg === "--url") {
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) opts.urls.push(argv[++i]);
    }
  }
  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const siteUrl = (process.env.APP_URL || "https://brostco.com").replace(/\/+$/, "");
  const host = new URL(siteUrl).hostname;

  let urlList: string[];
  if (opts.urls.length) {
    urlList = opts.urls;
  } else {
    const paths = [...PUBLIC_ROUTES.map((route) => route.path), ...EXTRA_PATHS];
    urlList = [...new Set(paths)].map((path) => absoluteUrl(siteUrl, path));
  }

  if (opts.only) urlList = urlList.filter((url) => url.includes(opts.only as string));

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

  const allowed = new Set([...PUBLIC_ROUTES.map(route => absoluteUrl(siteUrl, route.path)), ...EXTRA_PATHS.map(path => absoluteUrl(siteUrl, path))]);
  if (urlList.length > 10000 || urlList.some(url => !allowed.has(url))) {
    throw new Error("Only declared canonical public URLs may be submitted (maximum 10,000).");
  }
  for (const path of ["/", "/sitemap.xml", "/indexnow-key.txt"]) {
    const live = await fetch(`${siteUrl}${path}`, {
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    if (!live.ok) throw new Error(`${path} returned HTTP ${live.status}; nothing submitted.`);
    if (path === "/sitemap.xml" && !/<urlset[\\s>]/.test(await live.text())) {
      throw new Error("The live sitemap is not an XML URL set; nothing submitted.");
    }
    if (path === "/indexnow-key.txt" && (await live.text()).trim() !== INDEXNOW_KEY) {
      throw new Error("The live ownership key does not match; nothing submitted.");
    }
  }

  const response = await fetch(ENDPOINT, {
    signal: AbortSignal.timeout(20000),
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      host,
      key: INDEXNOW_KEY,
      keyLocation: `${siteUrl}/indexnow-key.txt`,
      urlList,
    }),
  });
  const text = await response.text();

  /**
   * 200 and 202 both mean accepted. The two failures worth naming are not
   * transient and will not fix themselves on a retry: 403 means the key file did
   * not serve the key we submitted, and 422 means the URLs did not belong to the
   * host, which would be a bug here rather than a problem out there.
   */
  if (response.status === 200 || response.status === 202) {
    console.log(`\nAccepted (HTTP ${response.status}).`);
    return;
  }
  console.error(`\nRejected: HTTP ${response.status} ${text.slice(0, 400)}`);
  if (response.status === 403) {
    console.error(
      `The key file did not match. Check that ${siteUrl}/indexnow-key.txt serves exactly "${INDEXNOW_KEY}" -- if the site is returning 5xx, that is the cause.`,
    );
  }
  if (response.status === 422) {
    console.error(`At least one URL was not on ${host}. That is a bug in this script's URL list.`);
  }
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
