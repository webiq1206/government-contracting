/**
 * Free contact discovery — no paid API. Fetches a prospect's own homepage and a
 * few common contact/about pages, then extracts published emails with the pure
 * logic in lib/domain/contact.ts. Everything here is a plain HTTP GET of pages
 * the site publishes for exactly this purpose, so it costs nothing and stays
 * within polite, white-hat behaviour (short timeout, one small crawl, honest
 * user-agent). Returns the best email plus a contact-form URL fallback.
 */
import { extractContacts } from "../domain/contact";
import { guardedFetch } from "./guarded-fetch";

const CANDIDATE_PATHS = ["", "/contact", "/contact-us", "/contact.html", "/about", "/about-us"];
const PER_PAGE_TIMEOUT_MS = 8_000;
const MAX_BYTES = 600_000; // don't slurp huge pages

/**
 * Fetch one page of a prospect's site.
 *
 * The URL comes from a prospect record or a search result, so it is external
 * data and goes through the shared guard. Before that it was a bare
 * `fetch(url, { redirect: "follow" })` with no destination check at all,
 * followed by `await res.arrayBuffer()` and only then a slice to MAX_BYTES,
 * which is a limit on what gets parsed rather than on what gets downloaded.
 */
async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await guardedFetch(url, {
      maxBytes: MAX_BYTES,
      timeoutMs: PER_PAGE_TIMEOUT_MS,
      allowInsecure: true,
      onOversize: "truncate",
      headers: {
        "user-agent": "BROSTCO-SiteAuthority/1.0 (+https://brostco.com; contact discovery)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.contentType.includes("html")) return null;
    return res.body.toString("utf8");
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
