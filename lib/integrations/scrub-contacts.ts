/**
 * Scrub government / solicitor contact information from text before it leaves
 * the system toward a subcontractor. Strips phones, emails, and common
 * contracting-officer name patterns so subs cannot bypass Brost Co.
 *
 * Replacements use [CONTACT REDACTED] so the surrounding sentence stays readable.
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

/**
 * Contracting officer / specialist introductions that often precede a name.
 * We redact the title + following 1-3 capitalized name tokens.
 */
const CO_NAME_RE =
  /\b(?:Contracting\s+Officer|Contract\s+Specialist|Contracting\s+Specialist|Point\s+of\s+Contact|POC|KO|COR|COTR)(?:'s)?\s*[:\-]?\s+[A-Z][a-zA-Z.'\-]+(?:\s+[A-Z][a-zA-Z.'\-]+){0,2}/g;

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
 * Remove phones, emails, and common solicitor name patterns from `text`.
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
      if (m.trim() === REDACTED) return m;
      count++;
      return REDACTED;
    })
    .replace(CO_NAME_RE, () => {
      count++;
      return REDACTED;
    });
  return { sanitised, count };
}
