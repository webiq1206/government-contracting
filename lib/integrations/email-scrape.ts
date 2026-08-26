/**
 * Key-free email discovery fallback: scrape a subcontractor's own website for
 * a published contact email, then sanity-check deliverability with a DNS MX
 * lookup. Used by Sub Verify when Hunter is not configured (or finds nothing).
 * Small contractors overwhelmingly publish an email on their homepage or
 * contact page, so this recovers a large share of contacts without any API key.
 */
import { resolveMx } from "node:dns/promises";
import { guardedFetch } from "./guarded-fetch";

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

/**
 * Fetch one page of a subcontractor's own website.
 *
 * The website field is operator-editable and website-finder guesses hosts, so
 * every URL here is untrusted and goes through the shared guard.
 *
 * This module used to carry its own copy of that guard, and the copy had a
 * hole: its IPv6 branch tested `startsWith("::ffff:")` and then re-checked the
 * remainder as a v4 address, but URL parsing rewrites `[::ffff:169.254.169.254]`
 * to `[::ffff:a9fe:a9fe]` long before the guard sees it, so the remainder was
 * "a9fe:a9fe", matched nothing, and the function returned true. The cloud
 * metadata endpoint was reachable through the website field. Two
 * implementations of one rule is how that survived, so there is now one.
 */
export async function safeFetchPage(rawUrl: string): Promise<string | null> {
  try {
    const res = await guardedFetch(rawUrl, {
      maxBytes: MAX_BODY_BYTES,
      timeoutMs: 10_000,
      maxRedirects: MAX_REDIRECTS,
      // A contractor site on plain http is common and still worth reading.
      allowInsecure: true,
      // A heavy page truncated at 500KB still yields its contact address;
      // refusing it outright would lose the contact for no safety gain.
      onOversize: "truncate",
      headers: { "user-agent": "Mozilla/5.0 (compatible; BROSTCO-SubVerify/1.0)" },
    });
    if (!res.contentType.includes("html") && !res.contentType.includes("text")) return null;
    return res.body.toString("utf8");
  } catch {
    // Every refusal is the same answer to the caller: no page to read.
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
