/**
 * Is our own site actually serving the pages we are trying to get linked to?
 *
 * This check exists because the rest of the programme assumed it. The verifier
 * reads other people's pages, the source-link checker reads government pages,
 * discovery asks public indexes -- and not one of them would notice that
 * brostco.com itself had stopped responding. It happened: every route answered
 * 500 or 502 for several minutes while the automation reported healthy, because
 * nothing was looking here.
 *
 * For a backlink programme this is the most expensive failure available, and it
 * is worse than merely losing traffic:
 *
 *   * A 5xx on /robots.txt is read by Google as "do not crawl", not as "no
 *     rules". Prolonged, it withdraws crawl access to the whole site.
 *   * A 5xx on /sitemap.xml removes the only list of URLs a crawler was given.
 *   * A citable page that 5xxs while somebody is deciding whether to cite it
 *     does not get cited, and they do not come back.
 *   * Every earned link then points at an error page, which is how earned links
 *     get removed.
 *
 * So this fails the run. Unlike a third party refusing us -- which says nothing
 * about anything -- our own site erroring is unambiguous, ours to fix, and
 * urgent.
 *
 * Usage:
 *   node scripts/seo/check-site-health.mjs
 *   node scripts/seo/check-site-health.mjs --site https://staging.example.com
 *   node scripts/seo/check-site-health.mjs --json PATH
 *
 * Exits non-zero if any checked URL is not 200, so the scheduled job raises an
 * issue rather than logging quietly.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const EVIDENCE = "docs/seo/site-health.json";

const UA =
  "BrostCo-Site-Health/1.0 (+https://brostco.com/; checking our own public pages respond)";

/**
 * The URLs whose failure would cost the most, in priority order.
 *
 * Deliberately a short hand-picked list rather than every public route. The
 * point is a fast, unambiguous answer to "is the site serving", and the three
 * crawler-facing endpoints plus the citable asset cover the ways this programme
 * can be silently destroyed. A full crawl belongs in a site audit, not in a
 * health gate that has to stay cheap enough to run daily.
 */
const CRITICAL_PATHS = [
  ["/", "home page"],
  ["/robots.txt", "crawl rules; a 5xx here reads as 'do not crawl' to Google"],
  ["/sitemap.xml", "the URL list given to crawlers"],
  ["/llms.txt", "what answer engines are told about the business"],
  ["/resources", "the resource index"],
  ["/resources/idaho-procurement-sources", "the citable register, the link-earning asset"],
  ["/resources/idaho-procurement-sources/data.json", "the register's machine-readable distribution"],
  ["/resources/idaho-procurement-sources/data.csv", "the register's spreadsheet distribution"],
  ["/indexnow-key.txt", "IndexNow ownership proof; a 5xx here silently breaks index submission"],
];

function parseArgs(argv) {
  const opts = { site: process.env.APP_URL || "https://brostco.com", json: EVIDENCE };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--site") opts.site = argv[++i];
    else if (argv[i] === "--json") opts.json = argv[++i];
  }
  opts.site = opts.site.replace(/\/+$/, "");
  return opts;
}

/**
 * GET once, then retry a 5xx a single time.
 *
 * One retry, not three: a deploy restart can produce a momentary 502, and
 * reporting that as an outage would cry wolf daily. But a site that fails twice
 * a few seconds apart is down, and retrying until it passes would be a way of
 * never reporting anything.
 */
async function probe(url) {
  for (const attempt of [1, 2]) {
    try {
      const started = Date.now();
      const response = await fetch(url, {
        headers: { "user-agent": UA },
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      });
      const ms = Date.now() - started;
      if (response.status < 500 || attempt === 2) {
        return { status: response.status, ms, attempts: attempt };
      }
    } catch (error) {
      if (attempt === 2) return { status: 0, error: error.message, attempts: attempt };
    }
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
  return { status: 0, error: "no response", attempts: 2 };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const results = [];

  console.log(`Site health for ${opts.site}`);
  for (const [path, why] of CRITICAL_PATHS) {
    const url = `${opts.site}${path}`;
    const probed = await probe(url);
    const ok = probed.status === 200;
    results.push({ path, url, why, ...probed, ok });
    const label = ok ? "OK  " : "DOWN";
    console.log(
      `  ${label} ${String(probed.status || probed.error).padEnd(6)} ${path}${ok ? "" : `   <- ${why}`}`,
    );
  }

  mkdirSync(dirname(opts.json), { recursive: true });
  writeFileSync(
    opts.json,
    `${JSON.stringify({ checkedAt: new Date().toISOString(), site: opts.site, results }, null, 2)}\n`,
  );
  console.log(`\nEvidence written to ${opts.json}`);

  const broken = results.filter((r) => !r.ok);
  if (!broken.length) {
    console.log("All critical URLs served 200.");
    return;
  }

  console.error(`\n${broken.length} of ${results.length} critical URL(s) are not serving:`);
  for (const r of broken) console.error(`  ${r.status || r.error}  ${r.url}\n      ${r.why}`);
  console.error(
    "\nNothing in a backlink programme works while this is true: a 5xx on robots.txt withdraws crawl access, and earned links pointing at error pages get removed. Fix the deployment before anything else here matters.",
  );
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
