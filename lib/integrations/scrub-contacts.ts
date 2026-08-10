/**
 * Scrub government contact information from text before it leaves the system
 * toward a subcontractor. Strips US phone numbers and email addresses so subs
 * cannot contact the contracting officer directly or look up the contract ceiling.
 *
 * Replacements use [CONTACT REDACTED] so the surrounding sentence stays readable
 * rather than collapsing into a grammatical mess.
 */

/**
 * US phone number patterns (covers the most common formats):
 *   (555) 867-5309 | 555-867-5309 | 555.867.5309 | 5558675309
 *   +1 555 867 5309 | 1-555-867-5309 | with ext / x 123
 */
const PHONE_RE =
  /(?:(?:\+?1[\s.\-]?)?(?:\(?\d{3}\)?[\s.\-]?)\d{3}[\s.\-]?\d{4}(?:\s*(?:ext|x)\.?\s*\d{1,5})?)/gi;

/**
 * Email addresses. Deliberately broad to catch unconventional TLDs (.gov,
 * .mil, .edu) that appear in government solicitations.
 */
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

const REDACTED = "[CONTACT REDACTED]";

/**
 * Rewrite raw SAM API notice URLs to the public SAM.gov web URL so external
 * recipients (subs) can actually open the link without an API key.
 *
 * Converts:
 *   https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=<id>
 * To:
 *   https://sam.gov/opp/<id>/view
 */
const SAM_API_RE =
  /https?:\/\/api\.sam\.gov\/[^?]*[?&]noticeid=([a-fA-F0-9-]{8,})/gi;

export function rewriteSamUrls(text: string): string {
  return text.replace(SAM_API_RE, (_m, noticeId: string) =>
    `https://sam.gov/opp/${noticeId}/view`
  );
}

/**
 * Remove phone numbers and email addresses from `text`.
 * Returns the sanitised string and a count of how many matches were removed.
 */
export function scrubGovtContacts(text: string): {
  sanitised: string;
  count: number;
} {
  let count = 0;
  const sanitised = text
    .replace(EMAIL_RE, () => {
      count++;
      return REDACTED;
    })
    .replace(PHONE_RE, (m) => {
      // Skip if already replaced as part of an email (shouldn't happen, but
      // be defensive — an email address can contain digits that look phone-like
      // after the @ is already stripped).
      if (m.trim() === REDACTED) return m;
      count++;
      return REDACTED;
    });
  return { sanitised, count };
}
