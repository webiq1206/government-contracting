/**
 * Key-free website discovery: find a contractor's own website via a free web
 * search (Bing HTML results — no API key) when Google Place Details is not
 * configured or returned nothing. A candidate is only accepted after a sanity
 * check that the site plausibly belongs to that company (name tokens in the
 * domain, or the company name appearing on the homepage), so we never save the
 * wrong company's site — a wrong site would poison email discovery downstream.
 */
import { safeFetchPage } from "./email-scrape";

// Brave Search serves plain-HTML organic results without a key or bot
// challenge (Bing degrades to first-word-only matches; DuckDuckGo serves a
// JS challenge page to non-browser clients).
const SEARCH_URL = "https://search.brave.com/search";

/**
 * Domains that can never be a contractor's own site: directories, social
 * networks, review aggregators, map services, and marketplaces.
 */
const AGGREGATOR_RE =
  /(^|\.)(facebook|instagram|linkedin|twitter|x|youtube|yelp|bbb|angi|angieslist|houzz|homeadvisor|thumbtack|yellowpages|yp|mapquest|google|bing|foursquare|manta|bizapedia|buzzfile|dnb|zoominfo|chamberofcommerce|porch|buildzoom|procore|constructionwire|levelset|sam|usaspending|dodge|bluebook|thebluebook|indeed|glassdoor|ziprecruiter|nextdoor|alignable|crunchbase|opencorporates|wikipedia|amazon|homedepot|lowes)\.(com|org|net|gov|co)$/i;

/** Lowercase alphanumeric tokens of a company name, minus generic filler. */
const GENERIC_TOKENS = new Set([
  "inc", "llc", "llp", "ltd", "co", "corp", "company", "companies", "the",
  "and", "of", "&", "group", "services", "service", "enterprises",
  "construction", "contractors", "contracting", "contractor", "general",
]);

function nameTokens(companyName: string): string[] {
  return companyName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !GENERIC_TOKENS.has(t));
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Pull organic result URLs out of a Brave Search HTML results page: direct
 * absolute hrefs, deduped by hostname, in page order (which is result order).
 * Engine-internal and static-asset links are skipped.
 */
export function extractSearchResultUrls(html: string): string[] {
  const urls: string[] = [];
  const seenHosts = new Set<string>();
  for (const m of html.matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"/gi)) {
    const url = m[1].replace(/&amp;/g, "&");
    const host = hostnameOf(url);
    if (!host) continue;
    if (/(^|\.)(brave\.com|bravesoftware\.com|w3\.org)$/.test(host)) continue;
    if (seenHosts.has(host)) continue;
    seenHosts.add(host);
    urls.push(url);
  }
  return urls;
}

/**
 * Does this candidate site plausibly belong to the company? The homepage is
 * always fetched (SSRF-guarded) and must carry evidence: the full company
 * name as a phrase, or every distinctive name token plus the company's
 * city/state. A domain-name resemblance alone is NOT enough — plenty of
 * unrelated sites share a word with a contractor's name (jackpot.com vs
 * "Jackpot Janitorial"), and saving the wrong site poisons email discovery.
 */
export async function validateCandidateSite(
  url: string,
  companyName: string,
  city?: string | null,
  state?: string | null
): Promise<boolean> {
  const host = hostnameOf(url);
  if (!host || AGGREGATOR_RE.test(host)) return false;
  const tokens = nameTokens(companyName);
  if (tokens.length === 0) return false;
  const html = await safeFetchPage(`https://${host}`);
  if (!html) return false;
  const pageText = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi, " ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ");
  const pageWords = new Set(pageText.split(/\s+/));
  // Strong signal: the normalized full name appears as a phrase.
  const phrase = companyName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (phrase && ` ${pageText.replace(/\s+/g, " ")} `.includes(` ${phrase} `)) return true;
  // Fallback: every distinctive name token on the page AND the company's
  // location mentioned (so a same-named company elsewhere doesn't slip in).
  const allTokens = tokens.every((t) => pageWords.has(t));
  if (!allTokens) return false;
  const cityWords = (city ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const cityOk = cityWords.length > 0 && cityWords.every((w) => pageWords.has(w));
  const stateOk = Boolean(state) && pageWords.has((state as string).toLowerCase());
  return cityOk || stateOk;
}

// Space searches out so batch rechecks don't trip Brave's burst rate limit.
const SEARCH_MIN_INTERVAL_MS = 30_000;
let lastSearchAt = 0;
let throttleChain: Promise<void> = Promise.resolve();
function throttle(): Promise<void> {
  throttleChain = throttleChain.then(async () => {
    const wait = lastSearchAt + SEARCH_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastSearchAt = Date.now();
  });
  return throttleChain;
}

/**
 * Search the web for the contractor's website. Returns the validated site's
 * origin (https://domain) or null. Never throws.
 */
export async function findWebsiteBysearch(params: {
  companyName: string;
  city?: string | null;
  state?: string | null;
}): Promise<string | null> {
  const { companyName, city, state } = params;
  if (!companyName.trim()) return null;
  const q = [`"${companyName}"`, city, state].filter(Boolean).join(" ");
  try {
    await throttle();
    let html: string | null = null;
    // Brave rate-limits bursts (429); back off once, then give up quietly —
    // the recheck sweep retries every sub within 7 days anyway.
    for (let attempt = 0; attempt < 3 && html == null; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 20_000 * attempt));
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10_000);
      try {
        const res = await fetch(`${SEARCH_URL}?q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
          headers: {
            // Deliberately minimal: browser-like UAs get JS bot-check pages
            // from this network, plain ones get parseable HTML.
            "user-agent": "Mozilla/5.0",
            accept: "text/html,application/xhtml+xml",
          },
        });
        if (res.status === 429) continue;
        if (!res.ok) return null;
        html = await res.text();
      } catch {
        // network hiccup — fall through to retry/return
      } finally {
        clearTimeout(timer);
      }
    }
    if (html == null) return null;
    const candidates = extractSearchResultUrls(html).slice(0, 5);
    for (const url of candidates) {
      if (await validateCandidateSite(url, companyName, city, state)) {
        const host = hostnameOf(url);
        if (host) return `https://${host}`;
      }
    }
    return null;
  } catch {
    return null;
  }
}
