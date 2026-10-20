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
// Addresses that are clearly not a business contact (tracking, packagers,
// images, template placeholders, font and site-builder licences). Mailing one
// of these bounces or reaches a vendor, and bounces are what a mailbox's
// reputation is judged on.
const JUNK_RE =
  /\.(png|jpe?g|gif|webp|svg|css|js)$|@(?:[a-z0-9-]+\.)*(example|sentry|sentry-next|wixpress|godaddy|placeholder|domain|yourdomain|email|website|mysite|latofonts|fontawesome|typekit|squarespace|weebly)\.|^(noreply|no-reply|donotreply|user|name|you|your|username|example)@/i;

export interface ScrapedEmail {
  email: string;
  /** True when the address is on the same domain as the website itself. */
  ownDomain: boolean;
  /** Exact public page where the address was observed, never a guessed mailbox. */
  sourceUrl?: string;
  sourceType?: "website" | "linked_social";
  checkedAt?: string;
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
  return (await fetchPublicPage(rawUrl))?.html ?? null;
}

async function fetchPublicPage(rawUrl: string): Promise<{ html: string; url: string } | null> {
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
    return { html: res.body.toString("utf8"), url: res.finalUrl };
  } catch {
    // Every refusal is the same answer to the caller: no page to read.
    return null;
  }
}

/**
 * An address Cloudflare's email protection hid: the first byte is a key and
 * every following byte is a character XORed with it. A large share of small
 * contractor sites publish their only address this way, and it reads as no
 * email at all to anything that does not decode it.
 */
export function decodeCloudflareEmail(hex: string): string | null {
  if (!/^(?:[0-9a-f]{2}){2,}$/i.test(hex)) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(out) ? out : null;
}

/** Undo the encodings sites use to hide an address from scrapers but not people. */
function revealEmails(html: string): string {
  const cloudflare = [
    ...html.matchAll(/data-cfemail\s*=\s*["']([0-9a-f]+)["']/gi),
    ...html.matchAll(/\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi),
  ].map((m) => decodeCloudflareEmail(m[1])).filter((e): e is string => Boolean(e));
  const entities = html
    .replace(/&#(\d{2,3});/g, (m, d) => (Number(d) < 128 ? String.fromCharCode(Number(d)) : m))
    .replace(/&#x([0-9a-f]{2});/gi, (m, h) => (parseInt(h, 16) < 128 ? String.fromCharCode(parseInt(h, 16)) : m))
    .replace(/&commat;/gi, "@")
    .replace(/&period;/gi, ".");
  return cloudflare.length ? `${entities}\n${cloudflare.map((e) => `mailto:${e}`).join("\n")}` : entities;
}

export function extractPublishedEmails(rawHtml: string, siteDomain: string | null): ScrapedEmail[] {
  const html = revealEmails(rawHtml);
  const found = new Map<string, ScrapedEmail>();
  // mailto: links first — they're deliberate contact addresses.
  for (const m of html.matchAll(/mailto:([^"'?\s>]+)/gi)) {
    let email: string;
    try { email = decodeURIComponent(m[1]).trim().toLowerCase(); }
    catch { continue; }
    if (/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email) && !JUNK_RE.test(email)) {
      found.set(email, { email, ownDomain: siteDomain != null && email.endsWith(`@${siteDomain}`) });
    }
    EMAIL_RE.lastIndex = 0;
  }
  for (const m of html.matchAll(EMAIL_RE)) {
    const email = m[0].toLowerCase();
    if (JUNK_RE.test(email)) continue;
    if (!found.has(email)) {
      found.set(email, { email, ownDomain: siteDomain != null && email.endsWith(`@${siteDomain}`) });
    }
  }
  return [...found.values()];
}

const SOCIAL_HOSTS = new Set(["facebook.com", "instagram.com", "linkedin.com"]);
/** Only profiles explicitly linked by the business's own site. Never search
 * social accounts by a similar name or follow login/challenge pages. */
export function linkedBusinessProfiles(html: string): string[] {
  const links = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["'](https:\/\/[^"']+)["']/gi)) {
    try {
      const url = new URL(match[1].replace(/&amp;/g, "&"));
      const host = url.hostname.toLowerCase().replace(/^www\./, "");
      if (!SOCIAL_HOSTS.has(host) || url.username || url.password || url.port) continue;
      if (url.pathname === "/" || /\/(?:login|signin|accounts|share|sharer|dialog|intent|plugins|checkpoint)(?:[/.]|$)/i.test(url.pathname)) continue;
      if (host === "linkedin.com" && !url.pathname.startsWith("/company/")) continue;
      url.search = "";
      url.hash = "";
      links.add(url.href);
      if (links.size === 2) break;
    } catch { /* Invalid public links are not evidence. */ }
  }
  return [...links];
}

/**
 * Scrape the site's homepage + common contact pages for a published email.
 * Prefers mailto/own-domain addresses. Returns null when nothing is found.
 */
/**
 * The site's own contact page, when it is not one of the usual paths:
 * "/contact.html", "/pages/contact", "/get-in-touch". Same domain only, and
 * at most two, so a lookup still reads a bounded number of pages.
 */
export function linkedContactPaths(html: string, pageUrl: string, domain: string): string[] {
  const paths = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    if (!/contact|get[\s-]?in[\s-]?touch|reach[\s-]?us|quote|estimate/i.test(`${m[1]} ${m[2]}`)) continue;
    try {
      const url = new URL(m[1].replace(/&amp;/g, "&"), pageUrl);
      if (!/^https?:$/.test(url.protocol) || normalizeDomain(url.href) !== domain) continue;
      const path = url.pathname.replace(/\/$/, "") || "/";
      if (path === "/" || CONTACT_PATHS.includes(path)) continue;
      paths.add(path + url.search);
      if (paths.size === 2) break;
    } catch { /* Not a usable link. */ }
  }
  return [...paths];
}

export async function scrapeWebsiteEmail(website: string): Promise<ScrapedEmail | null> {
  return (await scrapeWebsiteEmailDetailed(website)).email;
}

/**
 * The same lookup, saying how many of the firm's own pages were actually read.
 *
 * "No address" means two different things: the site could not be read, or it
 * was read and simply publishes none. Only the first is worth trying again;
 * treating the second as a failure re-ran the whole check three more times
 * for every small firm without a published address.
 */
export async function scrapeWebsiteEmailDetailed(
  website: string
): Promise<{ email: ScrapedEmail | null; pagesRead: number }> {
  let pagesRead = 0;
  const email = await scrapeSite(website, () => { pagesRead++; });
  return { email, pagesRead };
}

async function scrapeSite(website: string, onPageRead: () => void): Promise<ScrapedEmail | null> {
  const domain = normalizeDomain(website);
  if (!domain) return null;
  const base = `https://${domain}`;
  const all: ScrapedEmail[] = [];
  const social = new Set<string>();
  const paths = [...CONTACT_PATHS];
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    const page = await fetchPublicPage(base + path);
    if (!page) continue;
    const { html } = page;
    // A redirected directory or social page cannot establish site ownership.
    if (normalizeDomain(page.url) !== domain) continue;
    onPageRead();
    // The homepage names the real contact page when it is not a usual path.
    if (i === 0) for (const extra of linkedContactPaths(html, page.url, domain)) paths.splice(1, 0, extra);
    all.push(...extractPublishedEmails(html, domain).map((candidate) => ({
      ...candidate, sourceUrl: page.url, sourceType: "website" as const, checkedAt: new Date().toISOString(),
    })));
    for (const url of linkedBusinessProfiles(html)) if (social.size < 2) social.add(url);
    // Stop early once we have an own-domain hit; more pages won't beat it.
    if (all.some((e) => e.ownDomain)) break;
  }
  // Five business pages and at most two linked public profiles per lookup.
  // A social candidate never inherits own-domain verification from this link.
  if (!all.length) for (const url of social) {
    const page = await fetchPublicPage(url);
    if (!page || !linkedBusinessProfiles(`<a href="${page.url}">profile</a>`).length) continue;
    if (/<input\b[^>]*type\s*=\s*["']?password\b/i.test(page.html)) continue;
    for (const candidate of extractPublishedEmails(page.html, null)) {
      if (/(?:^|\.)(?:facebook|instagram|linkedin|meta|fb)\.com$/i.test(candidate.email.split("@")[1])) continue;
      all.push({
      ...candidate, ownDomain: false, sourceUrl: page.url, sourceType: "linked_social", checkedAt: new Date().toISOString(),
    });
    }
    if (all.length) break;
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
