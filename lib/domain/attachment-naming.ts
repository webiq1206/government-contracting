/**
 * The filename a subcontractor should actually see.
 *
 * What arrives from SAM and agency portals is what somebody's document system
 * exported: "Attachment_2._Wage_Determination.pdf",
 * "FA466126Q0027P00001_-_Amendment_1.pdf", "Statement_of_Work_E2_80_93_
 * Project_2.pdf" with an en dash percent-mangled into its own bytes. A
 * recipient scanning six of those in a mail client cannot tell which one to
 * open first, and the recovery work upstream (attachment-meta) only makes the
 * name TRUE — real extension, real words instead of "attachment" — not clear.
 *
 * This turns a true name into a presentable one: exhibit-numbering prefixes
 * and solicitation-number prefixes dropped when something descriptive remains,
 * separators flattened to spaces, mangled punctuation restored, the trade's
 * abbreviations ("SOW", "PWS", "WD") expanded to the words they stand for, and
 * casing normalised without wrecking acronyms. When nothing descriptive
 * remains at all, the name is manufactured from what the document IS —
 * "Amendment 1", "Wage Determination", "Solicitation FA466126Q0027" — which
 * still beats "attachment 3".
 *
 * Deliberately conservative: every rule either provably removes noise or
 * refuses. A wrong-but-plausible name on a bid document sends somebody to the
 * wrong file confident, which is worse than a clumsy name.
 *
 * Pure.
 */

import { parseDocumentClass, type DocumentClass } from "./document-inventory";

export interface NamingContext {
  /** The stored or classified document class, for manufactured fallbacks. */
  documentClass?: string | null;
  amendmentNumber?: number | null;
  solicitationNumber?: string | null;
  /** 1-based position in the packet, for the very last resort. */
  index?: number;
}

/** Acronyms that must survive casing untouched. */
const KEEP_UPPER = new Set([
  "AFB", "CAO", "IDIQ", "RFQ", "RFP", "RFO", "RFI", "IFB", "BAA", "PWS", "SOW",
  "USACE", "USAF", "USDA", "GSA", "DOD", "DLA", "NAVFAC", "HVAC", "QASP", "CLIN",
  "POP", "FOB", "SF", "DD", "FAR", "DFARS", "COR", "LEED", "OSHA", "EPA",
  "ANSI", "ASTM", "NFPA", "UFC", "UFGS", "USA", "II", "III", "IV",
]);

/** Small words stay lower unless they open the name. */
const SMALL_WORDS = new Set(["of", "and", "the", "to", "for", "in", "on", "at", "a", "an", "or", "per"]);

/** Word-level expansions: the reader should not need the trade's shorthand. */
const EXPANSIONS: [RegExp, string][] = [
  [/\bSOW\b/gi, "Statement of Work"],
  [/\bPWS\b/gi, "Performance Work Statement"],
  [/\bWD\b/gi, "Wage Determination"],
  [/\bAMD\b/gi, "Amendment"],
  [/\bAMDT\b/gi, "Amendment"],
  [/\bSPECS?\b/gi, "Specifications"],
  [/\bDWGS?\b/gi, "Drawings"],
  [/\bATTCH\b/gi, ""],
];

/**
 * Percent-encoding that lost its percent signs.
 *
 * Portals build filenames from URL segments, and somewhere along the way
 * "%E2%80%93" (an en dash) becomes literal "_E2_80_93_", "%26" ("&") becomes
 * "_26_", "%28"/"%29" (parentheses) become "_28"/"_29". Each substitution here
 * is gated on shapes that real names essentially never take, because turning a
 * genuine "Buildings 25 26 27" into "Buildings 25 & 27" would be worse than
 * every underscore it fixes.
 */
function demangleUnderscored(stem: string): string {
  let s = stem;
  // UTF-8 dash bytes spelled out: en dash (E2 80 93) and em dash (E2 80 94).
  s = s.replace(/[_\s]?E2[_\s]80[_\s]9[34][_\s]?/gi, " - ");
  // "(...)": _28 ... _29 as a matched pair around a short phrase.
  s = s.replace(/_28([A-Za-z0-9 _-]{1,40}?)_29/g, " ($1)");
  return s;
}

/**
 * "&" between single-letter tokens, after separators became spaces:
 * "Sections L 26 M" was "Sections L%26M", "J 26A" was "J%26A". Requiring a
 * lone letter on each side is what keeps "17 Jul 2026" and "7318 26 4320"
 * untouched — a mangled ampersand between whole words is indistinguishable
 * from a real number and is left alone.
 */
function restoreAmpersands(flattened: string): string {
  return flattened.replace(/\b([A-Za-z])\s+26\s*([A-Za-z])\b/g, "$1&$2");
}

function looksLikeNoticeId(token: string): boolean {
  // "FA466126Q0027", "W912DR26R0042", "FA466126Q0027P00001": long, no spaces,
  // both letters and several digits, in one block.
  return (
    /^[A-Za-z0-9-]{8,}$/.test(token) &&
    (token.match(/\d/g)?.length ?? 0) >= 4 &&
    /[A-Za-z]/.test(token)
  );
}

/** At least one real word: three letters together, somewhere. */
function isDescriptive(s: string): boolean {
  return /[A-Za-z]{3}/.test(s.replace(/\b(pdf|docx?|xlsx?)\b/gi, ""));
}

function recase(word: string): string {
  if (!word) return word;
  if (KEEP_UPPER.has(word.toUpperCase())) return word.toUpperCase();
  // Mixed case, digits, or short all-caps tokens ("E2", "SF30", "L&M"): as-is.
  if (/\d|&/.test(word)) return word;
  if (word === word.toUpperCase()) {
    if (word.length <= 3) return word;
    return word[0] + word.slice(1).toLowerCase();
  }
  if (word === word.toLowerCase()) {
    if (SMALL_WORDS.has(word)) return word;
    return word[0].toUpperCase() + word.slice(1);
  }
  return word;
}

function titleCase(s: string): string {
  const words = s.split(" ").filter(Boolean).map(recase);
  if (words.length) {
    const first = words[0];
    if (SMALL_WORDS.has(first)) words[0] = first[0].toUpperCase() + first.slice(1);
  }
  return words.join(" ");
}

/** "attachment 2", "document", "file 3": names that say nothing. */
const GENERIC_STEM_RE =
  /^(attachment|document|doc|file|download|untitled|scan|image|noname|unnamed|tmp|temp|exhibit|enclosure|appendix|tab|attach|atch)([\s-]*[a-z0-9]{1,3})?$/i;

const CLASS_FALLBACK: Partial<Record<DocumentClass, string>> = {
  solicitation: "Solicitation",
  amendment: "Amendment",
  drawing: "Drawings",
  specification: "Specifications",
  pricing_schedule: "Pricing Schedule",
  wage_determination: "Wage Determination",
  form: "Form",
  map: "Site Map",
  photo: "Site Photo",
};

/**
 * The clean stem (no extension) for one document.
 *
 * Never returns an empty string: when cleaning leaves nothing descriptive, the
 * name is manufactured from the document class, the solicitation number, and
 * the packet position, in that order of preference.
 */
export function professionalStem(name: string, ctx: NamingContext = {}): string {
  let s = String(name ?? "").trim();
  // The extension is the caller's business (byte-sniffing re-derives it).
  s = s.replace(/\.[A-Za-z0-9]{2,5}$/, "");

  s = demangleUnderscored(s);

  // Separators to spaces. A dot between word characters is a separator here
  // ("Attachment_2._Wage"), not punctuation worth keeping.
  s = s.replace(/_+/g, " ").replace(/\s*\.\s*/g, " ").replace(/\s+/g, " ").trim();
  // Spaced hyphens survive as a single " - "; glued ranges ("2020-2021") stay.
  s = s.replace(/\s+-\s+/g, " - ").replace(/^[-\s]+|[-\s]+$/g, "");
  s = restoreAmpersands(s);

  // Leading exhibit numbering, possibly stacked ("Attachment 2 Exhibit A x").
  for (let i = 0; i < 3; i++) {
    const stripped = s.replace(
      /^(attachment|attch|attach|atch|exhibit|enclosure|appendix|tab)\s*#?\s*[A-Za-z]?\d{0,3}[A-Za-z]?\s*[-:,]?\s+/i,
      ""
    );
    if (stripped === s || !isDescriptive(stripped)) break;
    s = stripped.trim();
  }

  // A leading solicitation/notice number when real words follow it.
  const first = s.split(" ")[0] ?? "";
  if (looksLikeNoticeId(first)) {
    const rest = s.slice(first.length).replace(/^[\s-]+/, "");
    if (isDescriptive(rest)) s = rest;
  }
  const sol = (ctx.solicitationNumber ?? "").trim();
  if (sol && s.toLowerCase().startsWith(sol.toLowerCase())) {
    const rest = s.slice(sol.length).replace(/^[\s-]+/, "");
    if (isDescriptive(rest)) s = rest;
  }

  for (const [re, to] of EXPANSIONS) s = s.replace(re, to);
  s = s.replace(/\s+/g, " ").trim();

  s = titleCase(s);

  // Nothing descriptive left: manufacture a name that at least says what it is.
  if (!isDescriptive(s) || GENERIC_STEM_RE.test(s)) {
    const cls = parseDocumentClass(ctx.documentClass);
    const base = CLASS_FALLBACK[cls];
    // A surviving identifier ("FA466126Q0027") is kept rather than buried.
    const idToken = looksLikeNoticeId(s) ? s : "";
    if (base === "Amendment") {
      if (ctx.amendmentNumber != null) return `Amendment ${ctx.amendmentNumber}`;
      return idToken ? `Amendment ${idToken}` : "Amendment";
    }
    if (base === "Solicitation") {
      const ref = idToken || sol;
      return ref ? `Solicitation ${ref}` : "Solicitation";
    }
    if (base) return base;
    if (idToken) return `Solicitation Document ${idToken}`;
    if (sol) return `${sol} Bid Document${ctx.index ? ` ${ctx.index}` : ""}`;
    return `Bid Document${ctx.index ? ` ${ctx.index}` : ""}`;
  }

  // A wage determination or amendment whose cleaned name is JUST the class
  // keyword keeps it; anything absurdly long is trimmed at a word break.
  if (s.length > 100) {
    const cut = s.slice(0, 100);
    s = cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : 100).trim();
  }
  return s;
}

/**
 * Make every filename in a packet unique after renaming.
 *
 * Two source files can clean to the same stem ("Wage Determination" from a WD
 * and its re-issue), and the package assessment rightly blocks a packet that
 * carries one name twice. Suffixing " (2)" before the extension keeps both
 * deliverable and tells the recipient there are two.
 */
export function uniqueFilename(filename: string, taken: Set<string>): string {
  const key = (n: string) => n.toLowerCase().replace(/[^a-z0-9.]+/g, "");
  if (!taken.has(key(filename))) {
    taken.add(key(filename));
    return filename;
  }
  const m = /^(.*?)(\.[A-Za-z0-9]{2,5})?$/.exec(filename)!;
  const stem = m[1] ?? filename;
  const ext = m[2] ?? "";
  for (let i = 2; ; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!taken.has(key(candidate))) {
      taken.add(key(candidate));
      return candidate;
    }
  }
}
