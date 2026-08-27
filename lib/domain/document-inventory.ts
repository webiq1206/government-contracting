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

export interface CitationTarget {
  id: string;
  name: string;
  pageCount: number | null;
}

export interface ResolvedCitation {
  documentId: string | null;
  documentName: string | null;
  page: number | null;
  /** Why there is no anchor, when there is no anchor. */
  problem: "no_citation" | "unknown_document" | "page_out_of_range" | null;
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,4}$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Turn "Attachment 2, page 14" into something that can be opened.
 *
 * A requirement whose source is a sentence is a requirement nobody can check.
 * The model is asked to name the document exactly as it was labelled in the
 * text it was given, and this maps that name back to a real inventory row.
 *
 * A name that matches nothing resolves to null with a reason rather than to
 * the closest guess. Attributing a page limit to the wrong document sends
 * somebody to read the wrong file and come away confident, which is worse than
 * telling them the citation could not be resolved.
 */
export function resolveCitation(
  documentName: unknown,
  page: unknown,
  documents: readonly CitationTarget[]
): ResolvedCitation {
  const rawName = typeof documentName === "string" ? documentName.trim() : "";
  const rawPage = typeof page === "number" && Number.isInteger(page) && page > 0 ? page : null;
  if (!rawName) {
    return { documentId: null, documentName: null, page: rawPage, problem: "no_citation" };
  }
  const wanted = normalizeName(rawName);
  const hit =
    documents.find((d) => d.name === rawName) ??
    documents.find((d) => normalizeName(d.name) === wanted) ??
    // A model given "Attachment 2 - Wage Determination.pdf" may cite
    // "Attachment 2". Containment is allowed only when exactly one document
    // matches, because two matches means the citation does not identify one.
    singleMatch(documents, (d) => {
      const n = normalizeName(d.name);
      return n.includes(wanted) || wanted.includes(n);
    });
  if (!hit) {
    return { documentId: null, documentName: rawName, page: rawPage, problem: "unknown_document" };
  }
  if (rawPage !== null && hit.pageCount !== null && rawPage > hit.pageCount) {
    // A page number past the end of the document is a hallucinated page, and
    // a link to it would open on nothing. Keep the document, drop the page.
    return {
      documentId: hit.id,
      documentName: hit.name,
      page: null,
      problem: "page_out_of_range",
    };
  }
  return { documentId: hit.id, documentName: hit.name, page: rawPage, problem: null };
}

function singleMatch<T>(items: readonly T[], fn: (t: T) => boolean): T | undefined {
  const hits = items.filter(fn);
  return hits.length === 1 ? hits[0] : undefined;
}

/**
 * Mark where each page begins, so a requirement can cite one.
 *
 * Without this the extracted text is a single wall, and the best a citation
 * could say was which file it came from. For a two-hundred-page specification
 * that means "open it and start looking", which is not a citation.
 *
 * The marker carries the page's real number, counted from the document rather
 * than from the pages that happened to have text on them. Renumbering around
 * blank pages would produce citations that are confidently one or two pages
 * out, and a citation that points at the wrong page is worse than none because
 * it will be believed.
 */
export function withPageMarkers(pages: readonly string[]): string {
  return pages
    .map((t, i) => (t.trim() ? `[p.${i + 1}]\n${t}` : ""))
    .filter(Boolean)
    .join("\n\n");
}

export interface InventorySnapshot {
  /** Stable across re-fetches: the storage key, not the display name. */
  key: string;
  name: string;
  contentHash: string | null;
  documentClass: DocumentClass;
  amendmentNumber: number | null;
}

export interface DocumentChanges {
  added: InventorySnapshot[];
  /** Same file, different bytes. The version that was read is gone. */
  changed: InventorySnapshot[];
  /** On the notice last time, not on it now. */
  removed: InventorySnapshot[];
  /** Any amendment among the added ones, highest number first. */
  newAmendments: InventorySnapshot[];
  unchanged: number;
  /** True when nothing about the source set moved. */
  quiet: boolean;
}

/**
 * What moved on this solicitation since the last time it was read.
 *
 * The change that matters most is the quiet one: an agency re-issues a file
 * under the same name with different content. Nothing about the document list
 * looks different, the count is the same, the names are the same, and every
 * requirement extracted from the old version is now describing a document
 * that no longer exists. Comparing bytes is the only way to see it.
 *
 * "Superseded" here means exactly that: the same file, re-issued. It does not
 * mean Amendment 0002 replaces Amendment 0001. Federal amendments are
 * cumulative and each one stands on its own, so treating a later amendment as
 * replacing an earlier one would hide a document that is still binding. New
 * amendments are reported separately, as arrivals rather than replacements.
 *
 * A document with no content hash on either side counts as unchanged rather
 * than as changed: an unknown hash is a gap in the record, and reporting a gap
 * as a change would make every run after a failed hash look like an amendment.
 */
export function documentChanges(
  previous: readonly InventorySnapshot[],
  current: readonly InventorySnapshot[]
): DocumentChanges {
  const before = new Map(previous.map((d) => [d.key, d]));
  const after = new Map(current.map((d) => [d.key, d]));

  const added: InventorySnapshot[] = [];
  const changed: InventorySnapshot[] = [];
  let unchanged = 0;

  for (const doc of current) {
    const was = before.get(doc.key);
    if (!was) {
      added.push(doc);
      continue;
    }
    if (was.contentHash && doc.contentHash && was.contentHash !== doc.contentHash) {
      changed.push(doc);
    } else {
      unchanged++;
    }
  }
  const removed = previous.filter((d) => !after.has(d.key));
  const newAmendments = added
    .filter((d) => d.documentClass === "amendment")
    .sort((a, b) => (b.amendmentNumber ?? -1) - (a.amendmentNumber ?? -1));

  return {
    added,
    changed,
    removed,
    newAmendments,
    unchanged,
    quiet: added.length === 0 && changed.length === 0 && removed.length === 0,
  };
}

/** One line for the Automation Log, saying what actually moved. */
export function changeSummary(changes: DocumentChanges): string {
  if (changes.quiet) return `No change to the ${changes.unchanged} source document(s).`;
  const parts: string[] = [];
  if (changes.newAmendments.length > 0) {
    parts.push(`${changes.newAmendments.length} new amendment(s): ${changes.newAmendments.map((a) => a.name).join(", ")}`);
  }
  const otherAdded = changes.added.length - changes.newAmendments.length;
  if (otherAdded > 0) parts.push(`${otherAdded} new document(s)`);
  if (changes.changed.length > 0) {
    parts.push(
      `${changes.changed.length} re-issued with different content: ${changes.changed.map((c) => c.name).join(", ")}`
    );
  }
  if (changes.removed.length > 0) {
    parts.push(`${changes.removed.length} no longer on the notice: ${changes.removed.map((r) => r.name).join(", ")}`);
  }
  return `${parts.join("; ")}. ${changes.unchanged} unchanged.`;
}

export interface DocumentRecord {
  id: string;
  name: string;
  documentClass: DocumentClass;
  version: number;
  amendmentNumber: number | null;
  pageCount: number | null;
  extractionState: ExtractionState;
  ocrState: OcrState | null;
  accessState: AccessState | null;
  disposition: Disposition;
  excludedReason: string | null;
  relevantToAll: boolean | null;
  tradeRelevance: string[] | null;
  sourceSystem: string | null;
  sourceUrl: string | null;
  lastVerifiedAt: Date | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  supersededBy: string | null;
  lastError: string | null;
  byteSize: number | null;
  storagePath: string | null;
  /** What the bytes are, so a preview does not have to guess from the name. */
  mime: string | null;
}

export type AttentionLevel = "blocker" | "watch" | "none";

export interface DocumentDisplay extends DocumentRecord {
  classLabel: string;
  extractionLabel: string;
  ocrLabel: string | null;
  accessLabel: string | null;
  dispositionLabel: string;
  /** Who this document matters to, in words. */
  relevanceLabel: string;
  attention: AttentionLevel;
  /**
   * What is wrong, in a sentence somebody can act on. Null when nothing is.
   *
   * Deliberately not a status word. "Unreadable" tells an operator a state;
   * "nothing in this file was ever read, so any requirement inside it is
   * missing from the brief" tells them why they should care.
   */
  problem: string | null;
  /** How this document can be shown in the page, if it can be. */
  preview: PreviewKind;
}

/**
 * Whether a document can be read without leaving the page, and how.
 *
 * `none` is a real answer and the honest one for a Word document or a
 * spreadsheet: a browser will not render it, and an empty frame that says
 * nothing is worse than a line saying it has to be downloaded. Never guessed
 * from the filename, because a .pdf that is really a scan of a fax is still a
 * PDF and a file named ".doc" that arrived as a PDF is still readable.
 */
export type PreviewKind = "pdf" | "image" | "text" | "none";

export function previewKind(doc: {
  mime: string | null;
  storagePath: string | null;
}): PreviewKind {
  // Nothing stored means nothing to show. That is not the same as a format we
  // cannot render, and the panel says so differently.
  if (!doc.storagePath) return "none";
  const mime = (doc.mime ?? "").toLowerCase();
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("text/") || mime === "application/json") return "text";
  return "none";
}

/**
 * How a document should read on the Documents tab.
 *
 * The rule the instructions set, and the one worth defending, is that a
 * document with a problem stays visible as a blocker rather than being tidied
 * away. Every branch below that returns "blocker" is a case where the bid was
 * assembled without something, and the screen must not look the same as one
 * where it was not.
 */
export function describeDocument(doc: DocumentRecord): DocumentDisplay {
  const relevanceLabel =
    doc.relevantToAll === true
      ? "Every trade"
      : doc.tradeRelevance && doc.tradeRelevance.length > 0
        ? doc.tradeRelevance.join(", ")
        : "Not yet assessed";

  let attention: AttentionLevel = "none";
  let problem: string | null = null;

  if (doc.supersededBy) {
    // Not a problem: a superseded document is history, and history is meant
    // to be kept. It just should not be read as current.
    attention = "watch";
    problem = "Replaced by a newer version of this file. Kept for history.";
  } else if (doc.disposition === "blocked") {
    attention = "blocker";
    problem =
      doc.lastError?.trim() ||
      "This document was not collected, so nothing in it has been read.";
  } else if (doc.disposition === "excluded") {
    attention = "watch";
    problem = `Excluded on purpose: ${doc.excludedReason?.trim() || "no reason recorded"}.`;
  } else if (doc.extractionState === "unreadable") {
    attention = "blocker";
    problem =
      "Stored, but nothing in it could be read, transcription included. Any requirement, form, page limit or deadline inside it is missing from the brief.";
  } else if (doc.extractionState === "not_read") {
    attention = "blocker";
    problem =
      "Stored, but its text never reached the analysis, so nothing in it informed the brief.";
  } else if (doc.extractionState === "partial") {
    attention = "blocker";
    problem = "Only part of this document was read. The rest has not informed the brief.";
  } else if (doc.extractionState === "pending") {
    attention = "watch";
    problem = "Not processed yet.";
  } else if (doc.accessState && doc.accessState !== "available") {
    // The text was read, so the brief is sound; the file itself can no longer
    // be fetched, which matters when somebody goes to open it.
    attention = "watch";
    problem =
      doc.accessState === "link_expired"
        ? "Read already, but the source link has expired, so it cannot be re-verified."
        : doc.accessState === "protected"
          ? "Password protected at the source."
          : "The source could not be reached on the last check.";
  }

  return {
    ...doc,
    classLabel: DOCUMENT_CLASS_LABEL[doc.documentClass],
    extractionLabel: EXTRACTION_STATE_LABEL[doc.extractionState],
    ocrLabel: doc.ocrState ? OCR_STATE_LABEL[doc.ocrState] : null,
    accessLabel: doc.accessState ? ACCESS_STATE_LABEL[doc.accessState] : null,
    dispositionLabel: DISPOSITION_LABEL[doc.disposition],
    relevanceLabel,
    attention,
    problem,
    preview: previewKind(doc),
  };
}

/**
 * Order for the Documents tab: what needs somebody first, then the newest
 * amendment, then everything else.
 *
 * Alphabetical would be tidier and would bury the one file nobody has read
 * under thirty that are fine.
 */
export function sortForReview(docs: readonly DocumentDisplay[]): DocumentDisplay[] {
  const rank = (d: DocumentDisplay) =>
    d.attention === "blocker" ? 0 : d.attention === "watch" ? 1 : 2;
  return [...docs].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (b.amendmentNumber ?? -1) - (a.amendmentNumber ?? -1) ||
      a.name.localeCompare(b.name)
  );
}

/**
 * A database row as an inventory record.
 *
 * Every state goes through its parser, which falls back to the pessimistic
 * value rather than the convenient one. A row written before migration 072, or
 * by a caller that forgot a column, reads as "somebody has to look at this"
 * instead of quietly rendering as read-in-full.
 *
 * `ocr_state` and `access_state` are the exceptions and stay null when null:
 * they are genuinely unknown for a non-PDF or a document nobody has re-checked,
 * and a screen saying "waiting to be transcribed" about a spreadsheet is noise,
 * not caution.
 */
export function toDocumentRecord(row: Record<string, unknown>): DocumentRecord {
  const date = (v: unknown): Date | null => (v instanceof Date ? v : null);
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  const trades = Array.isArray(row.trade_relevance)
    ? row.trade_relevance.filter((t): t is string => typeof t === "string")
    : null;
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? "Untitled"),
    documentClass: parseDocumentClass(row.document_class),
    version: num(row.version) ?? 1,
    amendmentNumber: num(row.amendment_number),
    pageCount: num(row.page_count),
    extractionState: parseExtractionState(row.extraction_state),
    ocrState: row.ocr_state == null ? null : parseOcrState(row.ocr_state),
    accessState: row.access_state == null ? null : parseAccessState(row.access_state),
    disposition: parseDisposition(row.disposition),
    excludedReason: str(row.excluded_reason),
    relevantToAll: typeof row.relevant_to_all === "boolean" ? row.relevant_to_all : null,
    tradeRelevance: trades && trades.length > 0 ? trades : null,
    sourceSystem: str(row.source_system),
    sourceUrl: str(row.source_url),
    lastVerifiedAt: date(row.last_verified_at),
    reviewedBy: str(row.reviewed_by),
    reviewedAt: date(row.reviewed_at),
    reviewNote: str(row.review_note),
    supersededBy: str(row.superseded_by),
    lastError: str(row.last_error),
    byteSize: num(row.byte_size),
    storagePath: str(row.storage_path),
    mime: str(row.mime),
  };
}
