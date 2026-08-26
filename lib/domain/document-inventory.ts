/**
 * What is known about one source file, and what became of it.
 *
 * A solicitation arrives as a pile of files from somebody else's system. The
 * question an operator actually has is not "how many documents are there" but
 * "is there anything in this bid I have not seen". That question can only be
 * answered if every source file has a resolved disposition: read, or delivered
 * some other way, or deliberately excluded with a reason somebody can argue
 * with, or a failure that blocks.
 *
 * The state that must never exist is the fourth one: a file that was there and
 * is now not accounted for. That is what `.slice(0, 40)` produced for years,
 * and nothing on any screen said so.
 *
 * Pure. The agent writes these values, the API reads them, the Documents tab
 * renders them, and none of them get to invent their own vocabulary.
 */

/** What kind of document this is, as far as anything can tell. */
export const DOCUMENT_CLASSES = [
  "solicitation",
  "amendment",
  "drawing",
  "specification",
  "pricing_schedule",
  "wage_determination",
  "form",
  "exhibit",
  "photo",
  "map",
  "archive",
  "other",
] as const;
export type DocumentClass = (typeof DOCUMENT_CLASSES)[number];

export const DOCUMENT_CLASS_LABEL: Record<DocumentClass, string> = {
  solicitation: "Solicitation",
  amendment: "Amendment",
  drawing: "Drawing",
  specification: "Specification",
  pricing_schedule: "Pricing schedule",
  wage_determination: "Wage determination",
  form: "Form",
  exhibit: "Exhibit",
  photo: "Photo",
  map: "Map",
  archive: "Archive",
  other: "Other",
};

/**
 * Exactly one of these per source file. Nothing may sit outside the list.
 *
 * `excluded` is the only one that requires a human sentence, because it is the
 * only one that is a judgement rather than an outcome. An exclusion with no
 * reason is indistinguishable from a file that got lost.
 */
export const DISPOSITIONS = ["delivered", "delivered_via_link", "excluded", "blocked"] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export const DISPOSITION_LABEL: Record<Disposition, string> = {
  delivered: "Read and included",
  delivered_via_link: "Delivered by secure link",
  excluded: "Deliberately excluded",
  blocked: "Blocking failure",
};

/** Did the text of this document actually reach an analysis? */
export const EXTRACTION_STATES = [
  "pending",
  "extracted",
  "partial",
  "not_read",
  "unreadable",
  "not_applicable",
] as const;
export type ExtractionState = (typeof EXTRACTION_STATES)[number];

export const EXTRACTION_STATE_LABEL: Record<ExtractionState, string> = {
  pending: "Not processed yet",
  extracted: "Read in full",
  partial: "Partly read",
  not_read: "Stored but not read",
  unreadable: "Nothing could be read",
  not_applicable: "No text to read",
};

/**
 * `partial`, `not_read` and `unreadable` are not degrees of success. Each one
 * means a requirement could be sitting in that file, unseen, and a brief built
 * without it must not read the same as a brief built with it.
 */
export function extractionIsComplete(state: ExtractionState): boolean {
  return state === "extracted" || state === "not_applicable";
}

export const OCR_STATES = ["not_needed", "pending", "done", "partial", "failed"] as const;
export type OcrState = (typeof OCR_STATES)[number];

export const OCR_STATE_LABEL: Record<OcrState, string> = {
  not_needed: "Has a text layer",
  pending: "Waiting to be transcribed",
  done: "Transcribed from page images",
  partial: "Partly transcribed",
  failed: "Could not be transcribed",
};

/** Can this file still be reached and opened? */
export const ACCESS_STATES = ["available", "link_expired", "unreachable", "protected"] as const;
export type AccessState = (typeof ACCESS_STATES)[number];

export const ACCESS_STATE_LABEL: Record<AccessState, string> = {
  available: "Available",
  link_expired: "Source link expired",
  unreachable: "Source could not be reached",
  protected: "Password protected",
};

function parse<T extends string>(values: readonly T[], v: unknown, fallback: T): T {
  const s = String(v ?? "").toLowerCase().trim();
  return (values as readonly string[]).includes(s) ? (s as T) : fallback;
}

/*
 * Every parse falls back to the pessimistic value, never the convenient one.
 * A row written by an older version of this code, or by a migration that
 * guessed, must not read as "read in full" because a column was empty.
 */
export const parseDocumentClass = (v: unknown): DocumentClass =>
  parse(DOCUMENT_CLASSES, v, "other");
export const parseDisposition = (v: unknown): Disposition => parse(DISPOSITIONS, v, "blocked");
export const parseExtractionState = (v: unknown): ExtractionState =>
  parse(EXTRACTION_STATES, v, "pending");
export const parseOcrState = (v: unknown): OcrState => parse(OCR_STATES, v, "pending");
export const parseAccessState = (v: unknown): AccessState => parse(ACCESS_STATES, v, "unreachable");

/**
 * Guess what a document is from its filename.
 *
 * A guess, and labelled as one everywhere it is shown, because SAM's own
 * metadata calls every attachment "attachment" and the filename is usually the
 * only signal there is. Ordered so the specific wins: "Amendment 0002 to the
 * Wage Determination" is an amendment.
 */
export function classifyDocumentName(name: string, mime?: string | null): DocumentClass {
  const s = `${name}`.toLowerCase();
  const m = `${mime ?? ""}`.toLowerCase();
  if (/\.(zip|rar|7z|tar|tgz|gz)$/.test(s) || /zip|x-rar|x-7z|x-tar|gzip/.test(m)) return "archive";
  if (/amend|modification|\bmod\s*\d|addend/.test(s)) return "amendment";
  if (/wage\s*determin|\bwd\b|davis.?bacon|sca\s*wage/.test(s)) return "wage_determination";
  if (/pricing|price\s*(sheet|schedule)|bid\s*schedule|\bclin\b|schedule\s*of\s*values/.test(s)) {
    return "pricing_schedule";
  }
  if (/\bsf.?\d{2,4}\b|\bform\b|\boffer\b.*\bform\b|representations|certifications/.test(s)) {
    return "form";
  }
  if (/drawing|\bdwg\b|blueprint|plan\s*set|sheet\s*[a-z]?\d/.test(s) || /\.dwg$/.test(s)) {
    return "drawing";
  }
  if (/\bmap\b|vicinity|site\s*map/.test(s)) return "map";
  if (/photo|\.jpe?g$|\.png$|image/.test(s) || /^image\//.test(m)) return "photo";
  if (/spec(ification)?s?\b|technical\s*requirement|division\s*\d/.test(s)) return "specification";
  if (/exhibit|attachment\s*[a-z0-9]|enclosure|appendix/.test(s)) return "exhibit";
  if (/solicitation|\bpws\b|\bsow\b|statement\s*of\s*work|\brfp\b|\brfq\b|\bifb\b|instructions/.test(s)) {
    return "solicitation";
  }
  return "other";
}

/**
 * The amendment number a filename carries, if it carries one.
 *
 * Used to order amendments and to spot the one that supersedes another.
 * Returns null rather than 0, because "no amendment number" and "amendment
 * zero" are different facts and a solicitation genuinely has neither.
 */
export function amendmentNumber(name: string): number | null {
  const m = /(?:amend(?:ment)?|modification|mod|addend(?:um)?)\D{0,6}(\d{1,4})/i.exec(name);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export interface InventoryRow {
  id: string;
  name: string;
  documentClass: DocumentClass;
  disposition: Disposition;
  extractionState: ExtractionState;
  excludedReason: string | null;
}

export interface InventoryCoverage {
  total: number;
  read: number;
  partial: number;
  notRead: number;
  unreadable: number;
  excluded: number;
  blocked: number;
  /**
   * True only when every source file has a disposition and nothing that should
   * have been read went unread.
   *
   * The prompt this implements is explicit that valid JSON from a model is not
   * completeness, and this is where that is enforced: an analysis is complete
   * when the inventory says every file was accounted for, not when the
   * extraction returned without throwing.
   */
  complete: boolean;
  /** What a person should be told, in one sentence. */
  summary: string;
}

export function inventoryCoverage(rows: readonly InventoryRow[]): InventoryCoverage {
  const count = (fn: (r: InventoryRow) => boolean) => rows.filter(fn).length;
  const read = count((r) => extractionIsComplete(r.extractionState) && r.disposition !== "excluded");
  const partial = count((r) => r.extractionState === "partial");
  const notRead = count((r) => r.extractionState === "not_read");
  const unreadable = count((r) => r.extractionState === "unreadable");
  const excluded = count((r) => r.disposition === "excluded");
  const blocked = count((r) => r.disposition === "blocked");
  /*
   * An exclusion with no reason does not count as accounted for. It is
   * indistinguishable from a file that was quietly lost, which is the exact
   * failure this inventory exists to make impossible.
   */
  const unreasonedExclusions = count(
    (r) => r.disposition === "excluded" && !r.excludedReason?.trim()
  );
  const complete =
    rows.length > 0 &&
    partial === 0 &&
    notRead === 0 &&
    unreadable === 0 &&
    blocked === 0 &&
    unreasonedExclusions === 0 &&
    count((r) => r.extractionState === "pending") === 0;

  const problems: string[] = [];
  if (blocked > 0) problems.push(`${blocked} could not be collected`);
  if (notRead > 0) problems.push(`${notRead} stored but not read`);
  if (unreadable > 0) problems.push(`${unreadable} unreadable`);
  if (partial > 0) problems.push(`${partial} only partly read`);
  if (unreasonedExclusions > 0) problems.push(`${unreasonedExclusions} excluded with no reason given`);
  const pending = count((r) => r.extractionState === "pending");
  if (pending > 0) problems.push(`${pending} not processed yet`);

  const summary =
    rows.length === 0
      ? "No source documents on this opportunity."
      : problems.length === 0
        ? `All ${rows.length} document(s) accounted for.`
        : `${read} of ${rows.length} document(s) read in full; ${problems.join(", ")}.`;

  return { total: rows.length, read, partial, notRead, unreadable, excluded, blocked, complete, summary };
}
