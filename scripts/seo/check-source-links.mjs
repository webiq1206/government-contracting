/**
 * Do the official sources this site sends people to still exist?
 *
 * Every guide and the procurement register point outward to an authority's own
 * page, and that is the whole basis on which another organization would link
 * here rather than maintain its own list. It also means link rot is not a
 * cosmetic problem: a moved purchasing page turns a register entry into a 404
 * that still looks authoritative, and somebody misses a bid because of it. A
 * public-sector site reorganising its URLs is routine, so the register has to
 * be re-checked rather than trusted.
 *
 * Reports four outcomes, and the middle two are the point.
 *
 *   ok        the URL answered 200
 *   moved     the URL answered, after a redirect to a different path
 *   blocked   403 or 429: we were refused, which says nothing about the page
 *   broken    404, 410, a server error, or no answer at all
 *
 * A redirect still works today and will not always: it is the warning that the
 * authority has reorganised and that the stored URL should be updated to
 * wherever it now lands, before the redirect is retired.
 *
 * `blocked` is separated from `broken` deliberately, and only `broken` fails
 * the run. A refusal is what a bot-protection layer or a restricted network
 * egress policy returns, and a page that has genuinely been removed returns 404
 * or 410 instead. Scoring the two the same way would gate a release on a
 * firewall rule and, worse, would report a set of perfectly good official links
 * as dead -- destroying confidence in the register to fix nothing.
 *
 * Usage:
 *   node scripts/seo/check-source-links.mjs           # register + guides
 *   node scripts/seo/check-source-links.mjs --register
 *   node scripts/seo/check-source-links.mjs --json PATH
 *
 * Exits non-zero when anything is broken, so it can gate a release. Needs
 * outbound access to the authorities' own domains; where egress is restricted
 * to an allowlist it will report every host as unreachable, which is a fact
 * about the network and not about the links.
 */

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

const UA =
  "BrostCo-Source-Link-Check/1.0 (+https://brostco.com/; checking that linked official sources still resolve)";

function parseArgs(argv) {
  const opts = { json: null, registerOnly: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--json") opts.json = argv[++i];
    else if (argv[i] === "--register") opts.registerOnly = true;
  }
  return opts;
}

/**
 * Read the two link lists out of source without importing them.
 *
 * Both modules are TypeScript, and a check that has to be compiled before it
 * can run is a check that gets skipped. The shape being matched is a literal
 * `href: "..."` in a data file, which is stable enough for the purpose and
 * fails loudly -- zero links found -- rather than quietly if it ever is not.
 */
function collectLinks({ registerOnly }) {
  const found = [];
  const files = registerOnly
    ? [["lib/marketing/procurement-sources.ts", "register"]]
    : [
        ["lib/marketing/procurement-sources.ts", "register"],
        ["lib/marketing/resources.ts", "guides"],
      ];
  for (const [file, origin] of files) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/href:\s*"(https?:\/\/[^"]+)"/g)) {
      found.push({ url: match[1], origin, file });
    }
  }
  const unique = new Map();
  for (const link of found) if (!unique.has(link.url)) unique.set(link.url, link);
  return [...unique.values()];
}

/**
 * HEAD first, then GET.
 *
 * Plenty of public-sector sites answer HEAD with 403 or 405 while serving the
 * page perfectly well to a GET, so treating a HEAD failure as a broken link
 * would fill the report with entries that are fine. HEAD is only worth trying
 * because it avoids downloading pages that are.
 */
async function probe(url) {
  for (const method of ["HEAD", "GET"]) {
    try {
      const response = await fetch(url, {
        method,
        headers: { "user-agent": UA },
        redirect: "follow",
        signal: AbortSignal.timeout(25_000),
      });
      if (method === "HEAD" && [403, 405, 501].includes(response.status)) continue;
      return { status: response.status, finalUrl: response.url, method };
    } catch (error) {
      if (method === "GET") return { status: 0, error: error.message, method };
    }
  }
  return { status: 0, error: "no response" };
}

/** Same page, ignoring a trailing slash and the scheme. */
function samePath(a, b) {
  const strip = (u) => u.replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
  return strip(a) === strip(b);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const links = collectLinks(opts);

  if (!links.length) {
    console.error(
      "No official-source links found. The href pattern this script matches has probably changed; fix the pattern rather than assuming there are no links.",
    );
    process.exitCode = 1;
    return;
  }

  const results = [];
  for (const link of links) {
    const probed = await probe(link.url);
    let verdict;
    if (probed.status === 200) {
      verdict = samePath(link.url, probed.finalUrl ?? link.url) ? "ok" : "moved";
    } else if (probed.status === 0) {
      verdict = "unreachable";
    } else if (probed.status === 403 || probed.status === 429) {
      verdict = "blocked";
    } else {
      verdict = "broken";
    }
    const record = { ...link, ...probed, verdict };
    results.push(record);
    const label = verdict.toUpperCase().padEnd(12);
    console.log(`${label} ${link.url}`);
    if (verdict === "moved") console.log(`             now redirects to ${probed.finalUrl}`);
    if (verdict === "broken") console.log(`             HTTP ${probed.status}`);
    if (verdict === "blocked") {
      console.log(
        `             HTTP ${probed.status}: refused before the page was served (bot protection or a network egress policy). Not a statement about the link.`,
      );
    }
    if (verdict === "unreachable") console.log(`             ${probed.error}`);
  }

  if (opts.json) {
    mkdirSync(dirname(opts.json), { recursive: true });
    writeFileSync(
      opts.json,
      `${JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2)}\n`,
    );
    console.log(`\nEvidence written to ${opts.json}`);
  }

  const counts = results.reduce((acc, r) => ({ ...acc, [r.verdict]: (acc[r.verdict] ?? 0) + 1 }), {});
  console.log(`\n${links.length} links: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}`);

  const moved = results.filter((r) => r.verdict === "moved");
  if (moved.length) {
    console.log("\nUpdate these stored URLs to where they now land, before the redirect is retired:");
    for (const r of moved) console.log(`  ${r.url}\n    -> ${r.finalUrl}  (${r.file})`);
  }

  const broken = results.filter((r) => r.verdict === "broken");
  if (broken.length) {
    console.error(`\n${broken.length} link(s) are broken and are sending readers to a dead page:`);
    for (const r of broken) console.error(`  HTTP ${r.status}  ${r.url}  (${r.file})`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
