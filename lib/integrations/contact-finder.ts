/**
 * Free contact discovery — no paid API. Fetches a prospect's own homepage and a
 * few common contact/about pages, then extracts published emails with the pure
 * logic in lib/domain/contact.ts. Everything here is a plain HTTP GET of pages
 * the site publishes for exactly this purpose, so it costs nothing and stays
 * within polite, white-hat behaviour (short timeout, one small crawl, honest
 * user-agent). Returns the best email plus a contact-form URL fallback.
 */
import { extractContacts } from "../domain/contact";

const CANDIDATE_PATHS = ["", "/contact", "/contact-us", "/contact.html", "/about", "/about-us"];
const PER_PAGE_TIMEOUT_MS = 8_000;
const MAX_BYTES = 600_000; // don't slurp huge pages

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": "BROSTCO-SiteAuthority/1.0 (+https://brostco.com; contact discovery)",
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(PER_PAGE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("html")) return null;
    const buf = await res.arrayBuffer();
    return Buffer.from(buf.slice(0, MAX_BYTES)).toString("utf8");
  } catch {
    return null;
  }
}

export interface ContactResult {
  email: string | null;
  emails: string[];
  contactForm: string | null; // a contact page URL we found (fallback when no email)
  checkedPages: number;
}

/**
 * Crawl a domain's public pages for a contact email. Stops early once a strong
 * on-domain role inbox is found to keep it cheap.
 */
export async function findContact(domain: string): Promise<ContactResult> {
  const host = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const emails = new Set<string>();
  let contactForm: string | null = null;
  let checkedPages = 0;

  for (const path of CANDIDATE_PATHS) {
    const url = `https://${host}${path}`;
    const html = await fetchText(url);
    if (html == null) continue;
    checkedPages++;

    // Remember a real contact page as a form fallback.
    if (/contact/i.test(path) && (/<form/i.test(html) || /contact/i.test(html))) {
      contactForm = contactForm ?? url;
    }

    const found = extractContacts(html, host);
    for (const e of found.emails) emails.add(e);

    // If we already have an on-domain role inbox, that's good enough.
    if (found.best && found.best.endsWith(`@${host.replace(/^www\./, "")}`)) break;
  }

  const ranked = extractContacts([...emails].map((e) => `mailto:${e}`).join(" "), host);
  return {
    email: ranked.best,
    emails: ranked.emails,
    contactForm,
    checkedPages,
  };
}
