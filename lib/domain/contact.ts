/**
 * Free contact discovery: extract published contact emails from a page's HTML.
 * No paid service (no Hunter.io) — we only read what a site publishes on its own
 * pages (mailto: links and visible addresses), exactly what a person would do by
 * visiting the site's contact page. Pure and unit-tested; the fetching lives in
 * lib/integrations/contact-finder.ts.
 */

// Role inboxes we prefer for outreach (a real person reads these), best first.
const ROLE_PREFIXES = [
  "info",
  "contact",
  "hello",
  "hi",
  "press",
  "media",
  "editor",
  "editorial",
  "marketing",
  "pr",
  "office",
  "team",
  "admin",
  "sales",
  "support",
];

// Never use these — automated, unmonitored, or placeholder addresses.
const BAD_LOCALPARTS = /^(no-?reply|do-?not-?reply|donotreply|postmaster|mailer-daemon|abuse)$/i;
const BAD_DOMAINS =
  /(example\.(com|org)|sentry\.io|wixpress\.com|godaddy\.com|\.png|\.jpg|\.jpeg|\.gif|\.webp|\.svg|domain\.com|email\.com|yourdomain\.com|sentry-next\.wixpress\.com)/i;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** The registrable-ish root of a host (last two labels). Good enough for matching. */
export function rootDomain(host: string): string {
  const clean = host
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split(":")[0];
  const parts = clean.split(".");
  return parts.length <= 2 ? clean : parts.slice(-2).join(".");
}

function isPlausibleEmail(email: string): boolean {
  const at = email.indexOf("@");
  if (at < 1) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (BAD_LOCALPARTS.test(local)) return false;
  if (BAD_DOMAINS.test(email)) return false;
  // Reject things that look like a filename or hashed asset reference.
  if (/[^A-Za-z0-9._%+-]/.test(local)) return false;
  if (local.length > 64 || domain.length > 255) return false;
  return true;
}

export interface ExtractedContacts {
  emails: string[]; // ranked best-first
  best: string | null; // top pick
}

/**
 * Extract candidate emails from HTML, ranked so the best outreach target is
 * first: on-site role inboxes beat on-site personal inboxes beat off-site ones.
 */
export function extractContacts(html: string, siteDomain: string): ExtractedContacts {
  if (!html) return { emails: [], best: null };
  const site = rootDomain(siteDomain);
  const found = new Set<string>();

  // Prefer explicit mailto: links (intentional contact points).
  const mailtoRe = /mailto:([^"'?\s>]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = mailtoRe.exec(html)) !== null) {
    const e = decodeURIComponent(m[1]).trim().toLowerCase();
    if (isPlausibleEmail(e)) found.add(e);
  }
  // Then visible addresses in the text.
  const text = html.replace(/<[^>]+>/g, " ");
  for (const raw of text.match(EMAIL_RE) ?? []) {
    const e = raw.trim().toLowerCase();
    if (isPlausibleEmail(e)) found.add(e);
  }

  const score = (email: string): number => {
    const [local, domain] = email.split("@");
    let s = 0;
    if (rootDomain(domain) === site) s += 100; // on the prospect's own domain
    const roleIdx = ROLE_PREFIXES.indexOf(local);
    if (roleIdx >= 0) s += 50 - roleIdx; // role inbox, earlier = better
    return s;
  };

  const emails = [...found].sort((a, b) => score(b) - score(a));
  return { emails, best: emails[0] ?? null };
}
