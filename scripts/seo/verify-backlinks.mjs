/**
 * Does the link actually exist, and does it actually pass authority?
 *
 * A backlink programme fails quietly. Somebody submits a listing, the platform
 * publishes it, the domain has a high authority score, and the link that
 * arrives carries `rel="nofollow"` -- or the placement page carries a
 * page-wide `<meta name="robots" content="nofollow">`, or the anchor points at
 * an out-link redirector instead of the destination. In all three cases the
 * placement looks like a win in a spreadsheet and is worth nothing as a
 * ranking signal. The only way to know is to fetch the live page and read the
 * markup, which is what this does.
 *
 * The ledger at docs/seo/backlink-ledger.json is the source of truth for what
 * has been claimed. This script is the thing that decides whether the claim
 * survives contact with the live web, and it is deliberately hostile to its
 * own ledger: an entry marked `published` that cannot be verified fails the
 * run, because an unverified claim in a backlink report is worse than no
 * report at all.
 *
 * Usage:
 *   node scripts/seo/verify-backlinks.mjs                 # verify the ledger
 *   node scripts/seo/verify-backlinks.mjs --probe URL...  # ad-hoc probe
 *   node scripts/seo/verify-backlinks.mjs --target HOST   # probe filter
 *   node scripts/seo/verify-backlinks.mjs --render        # use a browser
 *   node scripts/seo/verify-backlinks.mjs --json PATH     # write evidence
 *   node scripts/seo/verify-backlinks.mjs --ledger PATH   # check another list
 *
 * Read-only. It sends GET requests to public pages and stores no cookies.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { parseHTML } from "linkedom";

const LEDGER = "docs/seo/backlink-ledger.json";
const EVIDENCE = "docs/seo/backlink-verification.json";

/**
 * Identify honestly.
 *
 * A generic scraper user-agent gets served a challenge page by several of the
 * platforms worth checking, and a challenge page contains none of the links we
 * came to read -- which would be recorded as "link absent" when the truth is
 * "we were not allowed to look". Naming the checker and pointing at the site
 * it checks for makes the request legible to whoever reads the access log, and
 * an outright block becomes a distinguishable result rather than a silent
 * false negative.
 */
const UA =
  "BrostCo-Backlink-Verifier/1.0 (+https://brostco.com/; link-attribute audit; 1 request per page)";

/** rel tokens that stop a link passing authority, and what each one means. */
const DEVALUING = {
  nofollow: "nofollow, passes no authority",
  sponsored: "sponsored, treated as paid",
  ugc: "user-generated, discounted",
};

function parseArgs(argv) {
  const opts = { probe: [], target: null, render: false, json: EVIDENCE, only: null, ledger: LEDGER };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--render") opts.render = true;
    else if (arg === "--target") opts.target = argv[++i];
    else if (arg === "--json") opts.json = argv[++i];
    else if (arg === "--ledger") opts.ledger = argv[++i];
    else if (arg === "--only") opts.only = argv[++i];
    else if (arg === "--probe") {
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) opts.probe.push(argv[++i]);
    } else if (arg.startsWith("http")) opts.probe.push(arg);
  }
  return opts;
}

/**
 * Whether `host` is the target host or a subdomain of it.
 *
 * Endswith on its own would match `notbrostco.com` against `brostco.com`, so
 * the dot is load-bearing.
 */
function hostMatches(host, target) {
  const h = host.toLowerCase().replace(/^www\./, "");
  const t = target.toLowerCase().replace(/^www\./, "");
  return h === t || h.endsWith(`.${t}`);
}

/**
 * Pull the destination back out of an out-link redirector.
 *
 * Several directories publish `https://example.com/go?url=<encoded>` rather
 * than the destination itself. That is not the same link: the crawler follows
 * it to a page on the directory's own domain, and whatever authority the
 * placement carries stops there unless the redirector is a clean 301 that also
 * escapes the directory's nofollow rules. Detecting the pattern lets the
 * report say "wrapped" instead of scoring it as a direct dofollow.
 */
function unwrap(href, target) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  for (const [, value] of url.searchParams) {
    if (!value || value.length < 8) continue;
    for (const candidate of [value, decodeURIComponent(value)]) {
      try {
        const inner = new URL(candidate.startsWith("http") ? candidate : `https://${candidate}`);
        if (hostMatches(inner.hostname, target)) return inner.href;
      } catch {
        /* not a URL in this parameter */
      }
    }
  }
  return null;
}

/** GET a page as plain HTML. */
async function fetchStatic(url) {
  const response = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
  });
  const html = await response.text();
  return {
    status: response.status,
    finalUrl: response.url,
    xRobotsTag: response.headers.get("x-robots-tag") ?? null,
    contentType: response.headers.get("content-type") ?? null,
    html,
  };
}

/**
 * GET a page as a browser would, for placements that render links in script.
 *
 * Kept behind a flag and a per-entry `render` field rather than used for
 * everything. A headless browser is two orders of magnitude slower than a
 * fetch, and for a page that ships its links in the HTML it cannot tell us
 * anything the fetch did not.
 */
async function fetchRendered(url) {
  const { chromium } = await import("playwright");
  /**
   * Use a Chromium that is already on the machine when one is pinned.
   *
   * Playwright resolves its browser by build number, so a package upgrade
   * leaves it pointing at a build the image never downloaded and the launch
   * fails with "Executable doesn't exist". PLAYWRIGHT_CHROMIUM_EXECUTABLE (or
   * the conventional path under PLAYWRIGHT_BROWSERS_PATH) lets a pre-provisioned
   * browser be used instead of fetching a second copy.
   */
  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
    [`${process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers"}/chromium/chrome-linux/chrome`]
      .find((candidate) => existsSync(candidate));
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  try {
    const context = await browser.newContext({ userAgent: UA });
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
    return {
      status: response?.status() ?? 0,
      finalUrl: page.url(),
      xRobotsTag: response?.headers()["x-robots-tag"] ?? null,
      contentType: response?.headers()["content-type"] ?? null,
      html: await page.content(),
    };
  } finally {
    await browser.close();
  }
}

/**
 * Every link on the page that reaches the target, with its attributes.
 *
 * The page-level checks come first and deliberately override the per-link
 * result. A `nofollow` in the robots meta tag or the X-Robots-Tag header
 * applies to every link in the document, so an anchor with no rel attribute on
 * such a page is still nofollow -- and that combination is exactly the one a
 * spot-check by eye gets wrong.
 */
function inspect({ html, finalUrl, xRobotsTag }, target) {
  const { document } = parseHTML(html);

  const metaRobots = [...document.querySelectorAll('meta[name="robots" i]')]
    .map((m) => m.getAttribute("content") ?? "")
    .join(", ");
  const pageDirectives = `${metaRobots} ${xRobotsTag ?? ""}`.toLowerCase();
  const pageNofollow = /\bnofollow\b/.test(pageDirectives) || /\bnone\b/.test(pageDirectives);

  const links = [];
  for (const anchor of document.querySelectorAll("a[href]")) {
    const raw = anchor.getAttribute("href");
    let resolved;
    try {
      resolved = new URL(raw, finalUrl);
    } catch {
      continue;
    }
    const direct = hostMatches(resolved.hostname, target);
    const wrapped = direct ? null : unwrap(resolved.href, target);
    if (!direct && !wrapped) continue;

    const rel = (anchor.getAttribute("rel") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const devaluing = rel.filter((token) => token in DEVALUING);

    let attribute;
    if (pageNofollow) attribute = "nofollow";
    else if (devaluing.length) attribute = devaluing.join("+");
    else attribute = "dofollow";

    links.push({
      href: direct ? resolved.href : wrapped,
      via: wrapped ? resolved.href : null,
      anchorText: (anchor.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
      rel: rel.join(" ") || null,
      attribute,
      passesAuthority: attribute === "dofollow" && !wrapped,
      reason: pageNofollow
        ? `page-level nofollow (${pageDirectives.trim()})`
        : devaluing.map((t) => DEVALUING[t]).join("; ") || (wrapped ? "wrapped in an out-link redirector" : "no devaluing rel token"),
    });
  }
  return { pageNofollow, pageDirectives: pageDirectives.trim() || null, links };
}

/**
 * Name the interstitial, if the response is one.
 *
 * Matched on the title and on the absence of anchors rather than on a vendor
 * fingerprint, so a challenge page from a layer nobody has met yet is still
 * caught instead of being scored as a missing link.
 */
function detectChallenge(html) {
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
  const known = [
    "client challenge",
    "just a moment",
    "attention required",
    "checking your browser",
    "access denied",
    "are you a robot",
    "please enable javascript",
  ];
  const hit = known.find((needle) => title.toLowerCase().includes(needle));
  if (hit) return `title: ${title}`;
  if (!/<a\s[^>]*href=/i.test(html)) return "the document contains no links at all";
  return null;
}

async function check(entry, opts) {
  const target = entry.target ?? opts.target ?? "brostco.com";
  const record = {
    platform: entry.platform ?? new URL(entry.placementUrl).hostname,
    placementUrl: entry.placementUrl,
    destination: entry.destination ?? null,
    claimedStatus: entry.status ?? "probe",
    checkedAt: new Date().toISOString(),
  };
  try {
    const page = entry.render || opts.render ? await fetchRendered(entry.placementUrl) : await fetchStatic(entry.placementUrl);
    record.httpStatus = page.status;
    record.finalUrl = page.finalUrl;
    if (page.status !== 200) {
      /**
       * A 403 is the result most likely to be misread, in the direction that
       * matters. It can mean the platform refused us -- and it can equally
       * mean a network egress policy or a bot-protection layer never let the
       * request reach the platform at all. Those are opposite facts: the first
       * says something about the platform, the second says nothing whatsoever.
       * A refusal that carries no HTML body did not come from the page we
       * asked for, so it is reported as "blocked" and kept out of the findings
       * rather than being written down as though we had looked.
       */
      const looksLikeHtml = /html/i.test(page.contentType ?? "") && page.html.length > 512;
      if (page.status === 403 && !looksLikeHtml) {
        record.verdict = "blocked";
        record.detail =
          "HTTP 403 with no HTML body: the request was refused before the page was served (network egress policy or bot protection). This is not a finding about the platform's link attributes.";
      } else {
        record.verdict = "unreachable";
        record.detail = `HTTP ${page.status}`;
      }
      return record;
    }
    /**
     * A 200 is not proof that we were served the page.
     *
     * Bot-protection layers answer with HTTP 200 and an interstitial -- "Client
     * Challenge", "Just a moment" -- that carries the real page's status code
     * and none of its content. Parsed naively that becomes "no link found",
     * which reads in a report as "the platform dropped our link" when the
     * truth is that we never saw the platform. A document with no anchors at
     * all is the same tell: a real listing or article page has navigation.
     */
    const challenge = detectChallenge(page.html);
    if (challenge) {
      record.verdict = "blocked";
      record.detail = `HTTP 200 but the response is an interstitial (${challenge}), not the page. This is not a finding about the platform's link attributes.`;
      return record;
    }

    const { pageNofollow, pageDirectives, links } = inspect(page, target);
    record.pageDirectives = pageDirectives;
    record.pageNofollow = pageNofollow;
    record.links = links;
    if (!links.length) {
      record.verdict = "link-absent";
      record.detail = `no link to ${target} found in the served markup`;
    } else if (links.some((l) => l.passesAuthority)) {
      record.verdict = "dofollow";
      record.detail = links.find((l) => l.passesAuthority).href;
    } else {
      record.verdict = links[0].attribute === "dofollow" ? "wrapped" : links[0].attribute;
      record.detail = links[0].reason;
    }
  } catch (error) {
    record.verdict = "error";
    record.detail = error.message;
  }
  return record;
}

const GLYPH = {
  dofollow: "PASS dofollow",
  nofollow: "----  nofollow",
  wrapped: "~~~~  wrapped",
  "link-absent": "MISS absent",
  blocked: "n/a   blocked",
  unreachable: "????  unreachable",
  error: "ERR   error",
};

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  let entries;
  if (opts.probe.length) {
    entries = opts.probe.map((url) => ({ placementUrl: url, target: opts.target ?? "brostco.com" }));
  } else {
    const ledger = JSON.parse(readFileSync(opts.ledger, "utf8"));
    entries = ledger.placements.filter((p) => p.placementUrl);
    if (opts.only) entries = entries.filter((p) => (p.platform ?? "").toLowerCase().includes(opts.only.toLowerCase()));
  }

  if (!entries.length) {
    console.log("Nothing to verify: no ledger entry carries a live placement URL yet.");
    return;
  }

  const results = [];
  for (const entry of entries) {
    const record = await check(entry, opts);
    results.push(record);
    const glyph = GLYPH[record.verdict] ?? record.verdict;
    console.log(`${glyph.padEnd(18)} ${record.platform}`);
    console.log(`  placement  ${record.placementUrl}`);
    if (record.detail) console.log(`  detail     ${record.detail}`);
    for (const link of record.links ?? []) {
      console.log(`  -> ${link.attribute.padEnd(10)} rel=${link.rel ?? "(none)"} "${link.anchorText}"`);
    }
    console.log();
  }

  if (!opts.probe.length) {
    mkdirSync(dirname(opts.json), { recursive: true });
    writeFileSync(opts.json, `${JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2)}\n`);
    console.log(`Evidence written to ${opts.json}`);
  }

  const broken = results.filter((r) => r.claimedStatus === "published" && r.verdict !== "dofollow");
  if (broken.length) {
    console.error(`\n${broken.length} placement(s) claimed as published did not verify as dofollow:`);
    for (const r of broken) console.error(`  ${r.platform}: ${r.verdict} (${r.detail})`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
