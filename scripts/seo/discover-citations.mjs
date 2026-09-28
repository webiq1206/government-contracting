/**
 * Find out who is citing us, without paying for a backlink index.
 *
 * The honest constraint first, because it decides what this script is: a real
 * backlink index (Ahrefs, Majestic, Moz, Semrush) is the only way to enumerate
 * inbound links to a domain, and all of them are paid. This account's Ahrefs
 * plan returns "Insufficient plan" for API access, so that route is shut. What
 * remains are the sources that are free, keyless, and permitted to query, and
 * between them they cover the placements a citable reference actually earns:
 *
 *   Wikimedia   exturlusage lists every wiki page linking to a domain, across
 *               language editions. Wikipedia links are nofollow, so they pass no
 *               authority directly -- but a Wikipedia citation is read by the
 *               people who write the pages that do, and it is the single
 *               strongest signal that a reference is being treated as one.
 *   OpenAlex    scholarly works mentioning the domain. A university or policy
 *               paper citing the register is exactly the kind of .edu-adjacent
 *               attention that produces dofollow links from reading lists.
 *   Crossref    the same question asked of registered DOIs.
 *   Common      whether our own pages are in the public crawl at all. Not a
 *   Crawl       backlink, but the precondition for one: a page absent from the
 *               crawl is a page nobody's tooling can discover.
 *
 * What this is NOT: a complete picture of inbound links. It will not find a
 * directory listing or a blog mention. Saying so in the output matters, because
 * a discovery report that looks exhaustive and is not will be read as "nobody
 * links to us" when the truth is "we cannot see most of it".
 *
 * Every find is appended to the ledger as a `discovered` placement, which the
 * verifier then reads and checks for its actual link attribute. That is the
 * whole loop, and it needs nobody watching it: discover, record, verify.
 *
 * Usage:
 *   node scripts/seo/discover-citations.mjs
 *   node scripts/seo/discover-citations.mjs --domain example.com
 *   node scripts/seo/discover-citations.mjs --json PATH
 *   node scripts/seo/discover-citations.mjs --no-ledger    # report only
 *
 * Read-only against every remote. Exits 0 even when a source is unreachable: a
 * network failure at one provider is not a reason to fail a scheduled run, and
 * the per-source status is recorded so a persistent outage is visible.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const LEDGER = "docs/seo/backlink-ledger.json";
const EVIDENCE = "docs/seo/citation-discovery.json";

const UA =
  "BrostCo-Citation-Discovery/1.0 (+https://brostco.com/; finding citations of our own published reference data)";

function parseArgs(argv) {
  const opts = { domain: "brostco.com", json: EVIDENCE, ledger: true };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--domain") opts.domain = argv[++i];
    else if (argv[i] === "--json") opts.json = argv[++i];
    else if (argv[i] === "--no-ledger") opts.ledger = false;
  }
  return opts;
}

/** Fetch JSON, returning a tagged result instead of throwing. */
async function getJson(url) {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": UA, accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    return { ok: true, data: await response.json() };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/**
 * Wiki pages linking to the domain, across the busiest language editions.
 *
 * `euquery` matches the domain and everything under it. Queried per wiki because
 * external-link tables are per-wiki; English alone would miss a citation on the
 * Spanish or German Wikipedia, and for a US government-contracting reference the
 * English editions of Wikipedia and Wikinews are the realistic hits anyway.
 */
async function wikimedia(domain) {
  const wikis = [
    ["en.wikipedia.org", "English Wikipedia"],
    ["en.wikinews.org", "English Wikinews"],
    ["en.wikibooks.org", "English Wikibooks"],
    ["simple.wikipedia.org", "Simple English Wikipedia"],
  ];
  const found = [];
  const failures = [];
  for (const [host, label] of wikis) {
    const url =
      `https://${host}/w/api.php?action=query&list=exturlusage` +
      `&euquery=${encodeURIComponent(domain)}&eunamespace=0&eulimit=200&format=json&origin=*`;
    const result = await getJson(url);
    if (!result.ok) {
      failures.push({ source: label, error: result.error });
      continue;
    }
    for (const row of result.data?.query?.exturlusage ?? []) {
      found.push({
        source: label,
        placementUrl: `https://${host}/wiki/${encodeURIComponent(String(row.title).replace(/ /g, "_"))}`,
        title: row.title,
        // Wikimedia projects nofollow every external link, site-wide. Recorded
        // so nobody re-checks it hopefully, and so the ledger does not claim a
        // dofollow that cannot exist.
        expectedAttribute: "nofollow",
      });
    }
  }
  return { found, failures };
}

/**
 * Does this record actually mention the domain, or did the search engine guess?
 *
 * This guard is not paranoia, it is the lesson from the first live run. Both
 * Crossref and OpenAlex expose relevance search, not substring search: asking
 * Crossref for "brostco.com" returned fifty confident results whose top hits
 * were Las Vegas Sands litigation and a Brazilian theatre anthology. Nothing was
 * wrong with Crossref -- a fuzzy query answered fuzzily -- but taken at face
 * value it wrote fifty fictional citations into the ledger, which is precisely
 * the unverified claim this whole programme exists to prevent.
 *
 * So a hit counts only if the domain appears literally somewhere in the record.
 * A work that genuinely cites brostco.com carries the string; one the relevance
 * ranker merely liked does not. Cheap, and it fails closed.
 */
function mentionsDomain(record, domain) {
  return JSON.stringify(record).toLowerCase().includes(domain.toLowerCase());
}

/** Scholarly works that actually name the domain. */
async function openAlex(domain) {
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(domain)}&per-page=50`;
  const result = await getJson(url);
  if (!result.ok) return { found: [], failures: [{ source: "OpenAlex", error: result.error }] };
  const all = result.data?.results ?? [];
  const found = all
    .filter((work) => mentionsDomain(work, domain))
    .map((work) => ({
      source: "OpenAlex",
      placementUrl: work.doi ?? work.id,
      title: work.display_name,
      expectedAttribute: "unverified",
    }));
  return { found, failures: [], considered: all.length, discarded: all.length - found.length };
}

/** Registered DOIs that actually name the domain. */
async function crossref(domain) {
  const url = `https://api.crossref.org/works?query=${encodeURIComponent(domain)}&rows=50`;
  const result = await getJson(url);
  if (!result.ok) return { found: [], failures: [{ source: "Crossref", error: result.error }] };
  const all = result.data?.message?.items ?? [];
  const found = all
    .filter((item) => mentionsDomain(item, domain))
    .map((item) => ({
      source: "Crossref",
      placementUrl: item.URL,
      title: Array.isArray(item.title) ? item.title[0] : item.title,
      expectedAttribute: "unverified",
    }));
  return { found, failures: [], considered: all.length, discarded: all.length - found.length };
}

/**
 * Whether our own pages are present in the public crawl.
 *
 * Crawl presence is not a backlink, and is reported separately so it is never
 * counted as one. It answers the prior question: a page the open crawl has
 * never fetched is invisible to every downstream tool and dataset that is built
 * from it, so an absence here explains a silence everywhere else.
 */
async function commonCrawlPresence(domain) {
  /**
   * Ask which crawls exist rather than naming one.
   *
   * A hardcoded crawl id (CC-MAIN-2025-05) is wrong the moment the next crawl
   * lands: the index either 404s or, as the first live run showed, times out
   * with a 504, and the report then says "not in the crawl" about a crawl that
   * was never queried. collinfo.json lists the collections newest first.
   */
  let index = "CC-MAIN-latest-index";
  const collections = await getJson("https://index.commoncrawl.org/collinfo.json");
  if (collections.ok && Array.isArray(collections.data) && collections.data[0]?.["cdx-api"]) {
    index = collections.data[0]["cdx-api"];
  }
  const url = index.startsWith("http")
    ? `${index}?url=${encodeURIComponent(`${domain}/*`)}&output=json&limit=200`
    : `https://index.commoncrawl.org/${index}?url=${encodeURIComponent(`${domain}/*`)}&output=json&limit=200`;
  try {
    const response = await fetch(url, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(45_000),
    });
    if (response.status === 404) return { pages: [], note: "no pages of this domain in the queried crawl index" };
    if (!response.ok) return { pages: [], error: `HTTP ${response.status}` };
    const text = await response.text();
    const pages = [
      ...new Set(
        text
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            try {
              return JSON.parse(line).url;
            } catch {
              return null;
            }
          })
          .filter(Boolean),
      ),
    ];
    return { pages };
  } catch (error) {
    return { pages: [], error: error.message };
  }
}

/**
 * Add anything new to the ledger, leaving what is already recorded alone.
 *
 * Keyed on the placement URL so a run that finds the same citation twice does
 * not duplicate it, and so a human's own notes on an entry are never
 * overwritten by the next scheduled run.
 */
/**
 * How many new entries one run may add before it refuses.
 *
 * A citation programme for a young site gains findings one or two at a time. A
 * run proposing dozens is not a windfall, it is a broken filter -- which is
 * exactly what happened when a relevance search was trusted as a substring
 * search and fifty unrelated works arrived at once. Refusing is the safe
 * direction: a missed real citation is found again tomorrow, whereas fifty
 * fictional ones have to be noticed and unpicked by hand.
 */
const MAX_NEW_PER_RUN = 12;

function recordInLedger(found) {
  const ledger = JSON.parse(readFileSync(LEDGER, "utf8"));
  const known = new Set(ledger.placements.map((p) => p.placementUrl).filter(Boolean));
  const added = [];
  for (const item of found) {
    if (!item.placementUrl || known.has(item.placementUrl)) continue;
    known.add(item.placementUrl);
    added.push({
      platform: `${item.source}: ${item.title ?? "untitled"}`.slice(0, 160),
      status: "discovered",
      placementUrl: item.placementUrl,
      destination: "https://brostco.com",
      linkAttribute: item.expectedAttribute ?? "unverified",
      evidence: `Found by scripts/seo/discover-citations.mjs on ${new Date().toISOString().slice(0, 10)}. Attribute not yet read from the live page; run the verifier.`,
    });
  }
  if (added.length > MAX_NEW_PER_RUN) {
    return {
      added: [],
      refused: added.length,
      reason: `${added.length} new entries in one run exceeds the ${MAX_NEW_PER_RUN} allowed. Nothing was written. This almost always means a source's filter is matching too broadly; check docs/seo/citation-discovery.json before raising the cap.`,
    };
  }
  if (added.length) {
    ledger.placements.push(...added);
    ledger.asOf = new Date().toISOString().slice(0, 10);
    writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 2)}\n`);
  }
  return { added, refused: 0 };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { domain } = opts;

  const [wiki, alex, cross, crawl] = await Promise.all([
    wikimedia(domain),
    openAlex(domain),
    crossref(domain),
    commonCrawlPresence(domain),
  ]);

  const found = [...wiki.found, ...alex.found, ...cross.found];
  const failures = [...wiki.failures, ...alex.failures, ...cross.failures];
  const discarded =
    (alex.discarded ?? 0) + (cross.discarded ?? 0);

  console.log(`Citation discovery for ${domain}`);
  console.log(`  citations found : ${found.length}`);
  // Printed even when zero, so the filter's work is visible. A run that
  // considered fifty records and kept none is a healthy run, not a broken one,
  // and it should not look like the sources returned nothing.
  console.log(`  discarded       : ${discarded} relevance-search hit(s) that never mention ${domain}`);
  console.log(`  crawl presence  : ${crawl.pages.length} page(s)${crawl.error ? ` (error: ${crawl.error})` : ""}${crawl.note ? ` (${crawl.note})` : ""}`);
  if (failures.length) {
    console.log("  sources unreachable:");
    for (const f of failures) console.log(`    ${f.source}: ${f.error}`);
  }
  for (const item of found) {
    console.log(`  - [${item.source}] ${item.placementUrl}`);
  }

  let added = [];
  let refusal = null;
  if (opts.ledger && found.length) {
    const result = recordInLedger(found);
    added = result.added;
    if (result.refused) {
      refusal = result.reason;
      console.error(`\nRefused to write to the ledger: ${result.reason}`);
      process.exitCode = 1;
    } else {
      console.log(`\n${added.length} new ledger entr${added.length === 1 ? "y" : "ies"} recorded as "discovered".`);
      if (added.length) console.log("Run scripts/seo/verify-backlinks.mjs to read their actual link attributes.");
    }
  }

  mkdirSync(dirname(opts.json), { recursive: true });
  writeFileSync(
    opts.json,
    `${JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        domain,
        coverage:
          "Free keyless sources only (Wikimedia, OpenAlex, Crossref, Common Crawl). This is NOT a complete inbound-link picture: enumerating backlinks needs a paid index, and directory listings or blog mentions will not appear here.",
        filtering:
          "OpenAlex and Crossref expose relevance search, not substring search, so a hit is kept only when the domain appears literally in the record. `discardedRelevanceHits` counts results the ranker returned that never mention the domain; a high number there is the filter working.",
        citations: found,
        discardedRelevanceHits: discarded,
        crawlPresence: crawl,
        unreachableSources: failures,
        newLedgerEntries: added.length,
        ledgerWriteRefused: refusal,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\nEvidence written to ${opts.json}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
