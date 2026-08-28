/**
 * Which of a solicitation's documents a particular subcontractor actually needs.
 *
 * The gatherer used to attach the full stored set to every quote request, with
 * trade scoring only deciding which files consumed the size budget first. So a
 * roofer received the electrical specifications, the instructions the agency
 * wrote for the PRIME's offer, and everything else on the notice, and had to
 * open each file to learn it was not for them. A packet like that gets skimmed
 * or ignored, which costs the quote.
 *
 * This decides, per document, whether the subcontractor being emailed needs it
 * to price and perform their scope. Three sources of truth, in order:
 *
 *   1. What the analysis recorded. `relevant_to_all` and `trade_relevance` are
 *      explicit judgements on the document row and always win.
 *   2. What the document IS. Amendments, wage determinations, pricing
 *      schedules, statements of work and the solicitation itself govern every
 *      trade on the job and are always sent.
 *   3. What the name says. A specification or drawing that names a different
 *      trade's work, and nothing of this trade's, is another sub's document.
 *
 * The default is inclusion. A subcontractor cannot tell a document that was
 * withheld from one that does not exist, so the only omissions allowed are the
 * ones this module can give a reason for — and every omission carries that
 * reason, for the agent log and the operator.
 *
 * Pure: names and stored metadata in, decisions out. No storage, no network.
 */

import { classifyDocumentName, parseDocumentClass, type DocumentClass } from "./document-inventory";

export interface SelectableDocument {
  name: string;
  /** The analyst's stored class, when one was recorded. */
  documentClass?: string | null;
  /** Trades the analysis marked this document relevant to, when it did. */
  tradeRelevance?: string[] | null;
  /** True when the analysis marked this document as every trade's. */
  relevantToAll?: boolean | null;
  mime?: string | null;
}

export interface DocumentOmission<T extends SelectableDocument> {
  doc: T;
  /** Why this subcontractor does not need it, in a sentence an operator can argue with. */
  reason: string;
}

export interface DocumentSelection<T extends SelectableDocument> {
  included: T[];
  omitted: DocumentOmission<T>[];
}

/**
 * Document classes that govern every trade on the job.
 *
 * An amendment changes what everyone is pricing; a wage determination sets what
 * everyone pays; the solicitation and its forms carry the terms. None of these
 * may be filtered on a name, however trade-flavoured the name looks — except a
 * statement of work written FOR one trade, which is handled by name below
 * before the class is consulted.
 */
const EVERY_TRADE_CLASSES: ReadonlySet<DocumentClass> = new Set([
  "amendment",
  "wage_determination",
  "pricing_schedule",
  "form",
]);

/**
 * Material the agency wrote for the prime's offer, not for pricing the work.
 *
 * Provisions and clauses, Sections L and M, instructions to offerors,
 * representations and certifications: these tell the PRIME how to submit and be
 * evaluated. A subcontractor cannot use any of it to price their scope, and it
 * is exactly the kind of file that makes a packet feel like homework. The
 * flow-down obligations a sub does have to know about reach them another way:
 * the email's Requirements section and the wage determination, which is always
 * attached.
 *
 * Matched against a separator-normalised name, because these arrive as
 * "RFO_Provisions_and_Clauses.pdf" and "Sections_L_26_M.pdf".
 */
const PRIME_ONLY_RES: RegExp[] = [
  /\bprovisions?\b.{0,12}\bclauses\b/,
  /\bclauses\b.{0,12}\bprovisions?\b/,
  /\binstructions?\s+to\s+offerors?\b/,
  /\bsections?\s+l\b.{0,8}\bm\b/,
  /\bsection\s+[lm]\b(?!\w)/,
  /\brepresentations?\b.{0,10}\bcertifications?\b/,
  /\breps?\s+(and\s+)?certs?\b/,
  /\bevaluation\s+(criteria|factors)\b/,
];

/**
 * Trade families, for telling "another trade's document" from "this trade's".
 *
 * `trade` matches the trade string a subcontractor was sourced under;
 * `markers` matches document names. Markers are deliberately narrower than the
 * scoring keywords in opportunity-attachments: "air" or "power" in a filename
 * proves nothing ("Dyess Air Force Base"), while "electrical" or "ductwork"
 * does. A marker that fires on furniture words would silently withhold
 * documents, which is the expensive direction to be wrong in.
 */
const TRADE_FAMILIES: { id: string; label: string; trade: RegExp; markers: RegExp }[] = [
  { id: "electrical", label: "electrical", trade: /electr/, markers: /electric|lighting|switchgear|panelboard|low[\s-]?voltage/ },
  { id: "plumbing", label: "plumbing", trade: /plumb/, markers: /plumb/ },
  { id: "hvac", label: "mechanical/HVAC", trade: /hvac|mechanic/, markers: /hvac|mechanical|ductwork|chiller|boiler|refrigerant/ },
  { id: "roofing", label: "roofing", trade: /roof/, markers: /roof|membrane|shingle/ },
  { id: "flooring", label: "flooring", trade: /floor|carpet|tile/, markers: /floor|carpet|tile/ },
  { id: "painting", label: "painting", trade: /paint/, markers: /paint|coating/ },
  { id: "concrete", label: "concrete/masonry", trade: /concrete|mason|pav/, markers: /concrete|masonry|rebar|paving|asphalt/ },
  { id: "landscaping", label: "grounds/landscaping", trade: /landscap|ground/, markers: /landscap|irrigation|mowing/ },
  { id: "janitorial", label: "janitorial", trade: /janitor|custod|clean/, markers: /janitorial|custodial/ },
  { id: "water", label: "water treatment", trade: /water.{0,4}treat|treatment/, markers: /water\s+treatment/ },
  { id: "fencing", label: "fencing", trade: /fenc/, markers: /fenc/ },
  { id: "elevator", label: "elevator", trade: /elevator/, markers: /elevator/ },
  { id: "fire", label: "fire protection", trade: /fire|sprinkler/, markers: /fire\s+(alarm|protection|suppression)|sprinkler/ },
];

/** Underscores, dots-as-separators and percent-mangling flattened to spaces. */
function normalizedName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/, "")
    .replace(/%\d\d/g, " ")
    .replace(/[_.]+/g, " ")
    .replace(/[^a-z0-9&+-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function looksPrimeOnly(name: string): boolean {
  const n = normalizedName(name);
  return PRIME_ONLY_RES.some((re) => re.test(n));
}

function familiesMatching(text: string, field: "trade" | "markers"): Set<string> {
  const hits = new Set<string>();
  for (const f of TRADE_FAMILIES) {
    if (f[field].test(text)) hits.add(f.id);
  }
  return hits;
}

function familyLabel(ids: Set<string>): string {
  const labels = TRADE_FAMILIES.filter((f) => ids.has(f.id)).map((f) => f.label);
  return labels.join(" and ");
}

/** Loose, case-insensitive "does this stored trade tag mean this trade". */
function tagMatchesTrade(tag: string, trade: string): boolean {
  const a = tag.trim().toLowerCase();
  const b = trade.trim().toLowerCase();
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  // "HVAC" tagged, "Mechanical" sourced: same family is the same answer.
  const tagFamilies = familiesMatching(a, "trade");
  if (tagFamilies.size === 0) return false;
  for (const id of familiesMatching(b, "trade")) if (tagFamilies.has(id)) return true;
  return false;
}

/**
 * Is this document, by its name, another trade's and not this one's?
 *
 * Only a confident yes omits anything: the name must carry a known trade
 * family's marker, carry none of THIS trade's, and not contain the trade's own
 * words. A generic "Drawings.pdf" carries no markers and is included; a
 * "Mechanical and Electrical Specifications.pdf" carries the electrician's
 * marker and is included for them.
 */
export function namesAnotherTrade(
  name: string,
  trade: string
): { other: true; label: string } | { other: false } {
  const n = normalizedName(name);
  const docFamilies = familiesMatching(n, "markers");
  if (docFamilies.size === 0) return { other: false };

  const subFamilies = familiesMatching(trade.toLowerCase(), "trade");
  if (subFamilies.size === 0) {
    /*
     * A trade this table does not know ("Vindicator maintenance"). The doc
     * belongs to a known family, but we cannot rule out that it is also this
     * sub's; the only safe read is a word-level one against the trade string
     * itself, and failing that, inclusion.
     */
    return { other: false };
  }
  for (const id of subFamilies) if (docFamilies.has(id)) return { other: false };

  // The document's name may still contain the sub's own trade words even when
  // no family matched them (defence in depth for odd trade strings).
  const tradeWords = trade
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4);
  if (tradeWords.some((w) => n.includes(w))) return { other: false };

  return { other: true, label: familyLabel(docFamilies) };
}

function classOf(doc: SelectableDocument): DocumentClass {
  // The stored class when the analyst assigned a specific one; the name
  // otherwise, because "other" is also what an unclassified row parses to.
  const stored = parseDocumentClass(doc.documentClass);
  return stored !== "other" ? stored : classifyDocumentName(doc.name, doc.mime);
}

/**
 * Decide, per document, whether the subcontractor being emailed needs it.
 *
 * With no trade given the packet is a general one and only the prime-only
 * administrative material is omitted; everything else rides along.
 */
export function selectDocumentsForTrade<T extends SelectableDocument>(
  docs: readonly T[],
  trade: string | null | undefined
): DocumentSelection<T> {
  const included: T[] = [];
  const omitted: DocumentOmission<T>[] = [];
  const t = (trade ?? "").trim();

  for (const doc of docs) {
    // 1. The analysis's explicit judgement always wins, both directions.
    if (doc.relevantToAll === true) {
      included.push(doc);
      continue;
    }
    const tags = (doc.tradeRelevance ?? []).map((x) => String(x)).filter((x) => x.trim());
    if (tags.length > 0 && t) {
      if (tags.some((tag) => tagMatchesTrade(tag, t))) included.push(doc);
      else {
        omitted.push({
          doc,
          reason: `the analysis marked "${doc.name}" as relevant to ${tags.join(", ")}, not to ${t}, so it was left out of this packet`,
        });
      }
      continue;
    }

    // 2. Material written for the prime's offer, not for pricing the work.
    if (looksPrimeOnly(doc.name)) {
      omitted.push({
        doc,
        reason: `"${doc.name}" is the agency's offer-submission material for the prime contractor (provisions, instructions to offerors, or evaluation criteria), which a subcontractor does not need to price their scope`,
      });
      continue;
    }

    // 3. Documents that govern every trade are never filtered by name.
    const cls = classOf(doc);
    if (EVERY_TRADE_CLASSES.has(cls) || !t) {
      included.push(doc);
      continue;
    }

    // 4. A document whose name says it is another trade's, and not this one's.
    const other = namesAnotherTrade(doc.name, t);
    if (other.other) {
      omitted.push({
        doc,
        reason: `"${doc.name}" covers ${other.label} work, not ${t}, so it was left out of this packet`,
      });
      continue;
    }

    included.push(doc);
  }

  return { included, omitted };
}

/** One line per omission, for the agent log. */
export function describeOmissions(
  omitted: readonly { reason: string }[]
): string {
  return omitted.map((o) => `${o.reason}.`).join(" ");
}
