/**
 * Key-free email discovery fallback: scrape a subcontractor's own website for
 * a published contact email, then sanity-check deliverability with a DNS MX
 * lookup. Used by Sub Verify when Hunter is not configured (or finds nothing).
 * Small contractors overwhelmingly publish an email on their homepage or
 * contact page, so this recovers a large share of contacts without any API key.
 */
import { resolveMx, lookup } from "node:dns/promises";
import { isIP } from "node:net";

const CONTACT_PATHS = ["", "/contact", "/contact-us", "/about", "/about-us"];
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Addresses that are clearly not a business contact (tracking, packagers, images).
const JUNK_RE =
  /\.(png|jpe?g|gif|webp|svg|css|js)$|@(example|sentry|wixpress|godaddy|placeholder)\.|^(noreply|no-reply|donotreply)@/i;

export interface ScrapedEmail {
  email: string;
  /** True when the address is on the same domain as the website itself. */
  ownDomain: boolean;
}

function normalizeDomain(website: string): string | null {
  try {
    const url = website.includes("://") ? website : `https://${website}`;
    return new URL(url).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

const MAX_BODY_BYTES = 500_000;
const MAX_REDIRECTS = 3;

/** Reject loopback/private/link-local/reserved addresses (SSRF guard). */
function isPublicIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a >= 224) return false; // multicast/reserved
    return true;
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::1" || v6 === "::") return false;
  if (v6.startsWith("fe80") || v6.startsWith("fc") || v6.startsWith("fd")) return false;
  if (v6.startsWith("::ffff:")) return isPublicIp(v6.slice(7));
  return true;
}

/** The website field is operator-editable, so treat every URL as untrusted. */
async function isSafeUrl(url: URL): Promise<boolean> {
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname;
  if (isIP(host)) return isPublicIp(host);
  try {
    const { address } = await lookup(host);
    return isPublicIp(address);
  } catch {
    return false;
  }
}

/**
 * Fetch a page with SSRF + resource guards: http(s) only, public IPs only
 * (re-validated on every redirect hop), manual redirects capped at 3, and a
 * streaming body-size cap so a hostile site can't force an unbounded read.
 */
export async function safeFetchPage(rawUrl: string): Promise<string | null> {
  try {
    let url = new URL(rawUrl);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!(await isSafeUrl(url))) return null;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10_000);
      let res: Response;
      try {
        res = await fetch(url, {
          signal: ctrl.signal,
          headers: { "user-agent": "Mozilla/5.0 (compatible; BROSTCO-SubVerify/1.0)" },
          redirect: "manual",
        });
      } finally {
        clearTimeout(timer);
      }
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return null;
        url = new URL(loc, url); // next hop is re-validated at loop top
        continue;
      }
      if (!res.ok || !res.body) return null;
      const type = res.headers.get("content-type") ?? "";
      if (!type.includes("html") && !type.includes("text")) return null;
      // Stream with a hard byte cap instead of buffering the whole body.
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (total < MAX_BODY_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        chunks.push(value);
      }
      await reader.cancel().catch(() => undefined);
      return Buffer.concat(chunks).toString("utf8").slice(0, MAX_BODY_BYTES);
    }
    return null; // too many redirects
  } catch {
    return null;
  }
}

function extractEmails(html: string, siteDomain: string | null): ScrapedEmail[] {
  const found = new Map<string, ScrapedEmail>();
  // mailto: links first — they're deliberate contact addresses.
  for (const m of html.matchAll(/mailto:([^"'?\s>]+)/gi)) {
    const email = decodeURIComponent(m[1]).trim().toLowerCase();
    if (EMAIL_RE.test(email) && !JUNK_RE.test(email)) {
      found.set(email, { email, ownDomain: siteDomain != null && email.endsWith(`@${siteDomain}`) });
    }
    EMAIL_RE.lastIndex = 0;
  }
  for (const m of html.matchAll(EMAIL_RE)) {
    const email = m[0].toLowerCase().replace(/^\d+/, ""); // strip leading digits glued by minified html
    if (JUNK_RE.test(email)) continue;
    if (!found.has(email)) {
      found.set(email, { email, ownDomain: siteDomain != null && email.endsWith(`@${siteDomain}`) });
    }
  }
  return [...found.values()];
}

/**
 * Scrape the site's homepage + common contact pages for a published email.
 * Prefers mailto/own-domain addresses. Returns null when nothing is found.
 */
export async function scrapeWebsiteEmail(website: string): Promise<ScrapedEmail | null> {
  const domain = normalizeDomain(website);
  if (!domain) return null;
  const base = `https://${domain}`;
  const all: ScrapedEmail[] = [];
  for (const path of CONTACT_PATHS) {
    const html = await safeFetchPage(base + path);
    if (!html) continue;
    all.push(...extractEmails(html, domain));
    // Stop early once we have an own-domain hit; more pages won't beat it.
    if (all.some((e) => e.ownDomain)) break;
  }
  if (!all.length) return null;
  all.sort((a, b) => Number(b.ownDomain) - Number(a.ownDomain));
  return all[0];
}

/**
 * DNS-level deliverability check: does the address's domain publish MX records?
 * Not as strong as an SMTP-level verify (Hunter), but catches dead domains and
 * typos, and is free. Returns false on any lookup failure.
 */
export async function domainHasMx(email: string): Promise<boolean> {
  const domain = email.split("@")[1];
  if (!domain) return false;
  try {
    const mx = await resolveMx(domain);
    return mx.length > 0;
  } catch {
    return false;
  }
}
