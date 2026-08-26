/**
 * Normalize attachment filenames and MIME types so email clients (and Resend's
 * filename-derived typing) can open solicitation PDFs/DOCX. SAM.gov often
 * serves real PDFs as application/octet-stream with the name "attachment".
 */
import { looksLikePdfBytes } from "../integrations/pdf";

export type AttachmentKind =
  | "pdf"
  | "docx"
  | "doc"
  | "xlsx"
  | "xls"
  | "txt"
  | "html"
  | "unknown";

export interface NormalizedAttachmentMeta {
  filename: string;
  mime: string;
  kind: AttachmentKind;
}

const KIND_META: Record<
  Exclude<AttachmentKind, "unknown">,
  { ext: string; mime: string }
> = {
  pdf: { ext: "pdf", mime: "application/pdf" },
  docx: {
    ext: "docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  doc: { ext: "doc", mime: "application/msword" },
  xlsx: {
    ext: "xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  xls: { ext: "xls", mime: "application/vnd.ms-excel" },
  txt: { ext: "txt", mime: "text/plain" },
  html: { ext: "html", mime: "text/html" },
};

const MIME_TO_KIND: Record<string, AttachmentKind> = {
  "application/pdf": "pdf",
  "application/x-pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/plain": "txt",
  "text/html": "html",
  "application/xhtml+xml": "html",
};

const EXT_TO_KIND: Record<string, AttachmentKind> = {
  pdf: "pdf",
  docx: "docx",
  doc: "doc",
  xlsx: "xlsx",
  xls: "xls",
  txt: "txt",
  html: "html",
  htm: "html",
};

/** ZIP local-file signature (DOCX/XLSX/PPTX are ZIP packages). */
export function looksLikeZipBytes(data: Uint8Array | Buffer): boolean {
  if (data.length < 4) return false;
  return data[0] === 0x50 && data[1] === 0x4b && (data[2] === 0x03 || data[2] === 0x05 || data[2] === 0x07);
}

/**
 * Heuristic DOCX sniff: ZIP magic plus an OOXML "word/" or Content_Types marker
 * in the leading bytes (local headers / early central directory).
 */
export function looksLikeDocxBytes(data: Uint8Array | Buffer): boolean {
  if (!looksLikeZipBytes(data) || data.length < 64) return false;
  const sample = Buffer.from(data.subarray(0, Math.min(data.length, 16_384))).toString("latin1");
  return (
    sample.includes("word/") ||
    (sample.includes("[Content_Types].xml") && sample.includes("wordprocessingml"))
  );
}

export function looksLikeXlsxBytes(data: Uint8Array | Buffer): boolean {
  if (!looksLikeZipBytes(data) || data.length < 64) return false;
  const sample = Buffer.from(data.subarray(0, Math.min(data.length, 16_384))).toString("latin1");
  return sample.includes("xl/") || (sample.includes("[Content_Types].xml") && sample.includes("spreadsheetml"));
}

/** Strip path segments and characters that break MIME headers / email clients. */
export function sanitizeAttachmentFilename(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "attachment";
  const cleaned = base
    .replace(/[\r\n"\0]/g, "")
    .replace(/[^\w.\- ()[\]]+/g, "_")
    .replace(/_+/g, "_")
    .trim();
  return (cleaned || "attachment").slice(0, 180);
}

function extensionOf(filename: string): string | null {
  const m = /\.([a-z0-9]{2,5})$/i.exec(filename);
  return m ? m[1]!.toLowerCase() : null;
}

function kindFromMime(mime: string | null | undefined): AttachmentKind | null {
  if (!mime) return null;
  const base = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  return MIME_TO_KIND[base] ?? null;
}

function kindFromFilename(filename: string): AttachmentKind | null {
  const ext = extensionOf(filename);
  if (!ext) return null;
  return EXT_TO_KIND[ext] ?? null;
}

function kindFromBytes(content: Uint8Array | Buffer | null | undefined): AttachmentKind | null {
  if (!content || content.length === 0) return null;
  if (looksLikePdfBytes(content)) return "pdf";
  if (looksLikeDocxBytes(content)) return "docx";
  if (looksLikeXlsxBytes(content)) return "xlsx";
  return null;
}

function withExtension(filename: string, ext: string): string {
  const safe = sanitizeAttachmentFilename(filename);
  const current = extensionOf(safe);
  if (current === ext) return safe;
  if (!current) return `${safe}.${ext}`;
  // Replace wrong or generic extensions so clients open the real file type.
  const stem = safe.slice(0, -(current.length + 1)) || "attachment";
  return `${stem}.${ext}`;
}

/**
 * Resolve a trustworthy filename + MIME for email/file delivery.
 * Byte sniffing wins over SAM's generic Content-Type and opaque names.
 */
export function normalizeAttachmentMeta(input: {
  filename: string;
  mime?: string | null;
  content?: Uint8Array | Buffer | null;
}): NormalizedAttachmentMeta {
  const rawName = sanitizeAttachmentFilename(input.filename || "attachment");
  const fromBytes = kindFromBytes(input.content ?? null);
  const fromMime = kindFromMime(input.mime);
  const fromName = kindFromFilename(rawName);

  // Prefer authoritative bytes, then a specific MIME, then the filename extension.
  const kind: AttachmentKind =
    fromBytes ??
    (fromMime && fromMime !== "unknown" ? fromMime : null) ??
    fromName ??
    "unknown";

  if (kind !== "unknown") {
    const meta = KIND_META[kind];
    return {
      kind,
      mime: meta.mime,
      filename: withExtension(rawName, meta.ext),
    };
  }

  // Unknown type: keep a useful filename and the best MIME we have.
  const mime =
    (input.mime && !/octet-stream/i.test(input.mime) ? input.mime.split(";")[0]!.trim() : null) ??
    "application/octet-stream";
  return { kind: "unknown", filename: rawName, mime };
}

/**
 * Recover the real filename of a downloaded attachment.
 *
 * SAM's notice JSON lists resourceLinks as bare API URLs with no name, so
 * ingest labels every one of them "attachment" and, until this existed, that
 * label became the stored document name. The blast radius was wider than
 * cosmetics: trade prioritisation ranks documents by name, so identical names
 * meant no ranking; official-form linking matches "SF-1449" against document
 * names, so it could never match; and a subcontractor received files literally
 * called attachment.pdf.
 *
 * The server does say the name, in Content-Disposition, which is where this
 * looks first (RFC 5987 filename*= before plain filename=). Failing that, a
 * URL whose last path segment carries an extension is trusted. Failing both,
 * the caller's label stands and byte-sniffing still corrects the extension.
 */
export function filenameFromResponse(input: {
  contentDisposition?: string | null;
  url?: string | null;
  fallback: string;
}): string {
  const cd = input.contentDisposition ?? "";

  // filename*=UTF-8''...  (RFC 5987; may be quoted, percent-encoded)
  const ext = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(cd);
  if (ext?.[1]) {
    try {
      const decoded = decodeURIComponent(ext[1].trim().replace(/^"|"$/g, ""));
      const safe = sanitizeAttachmentFilename(decoded);
      if (safe !== "attachment") return safe;
    } catch {
      /* malformed percent-encoding: fall through */
    }
  }

  // filename="..." or filename=...
  const plain = /filename\s*=\s*("([^"]+)"|[^;]+)/.exec(cd);
  const plainName = plain?.[2] ?? (plain?.[1] && !plain[1].startsWith('"') ? plain[1] : null);
  if (plainName) {
    const safe = sanitizeAttachmentFilename(plainName.trim());
    if (safe !== "attachment") return safe;
  }

  // Last URL segment, only when it looks like a real file (has an extension).
  if (input.url) {
    try {
      const segment = decodeURIComponent(
        new URL(input.url).pathname.split("/").pop() ?? ""
      );
      if (segment && extensionOf(segment)) {
        const safe = sanitizeAttachmentFilename(segment);
        if (safe !== "attachment") return safe;
      }
    } catch {
      /* not a parseable URL */
    }
  }

  return input.fallback;
}

/**
 * Turn a PDF's metadata Title into a usable filename, or refuse.
 *
 * Titles come from authoring tools, so the common shapes are "Microsoft Word
 * - Statement of Work.doc", a bare filename, real prose, or junk like
 * "untitled". The junk must be refused rather than cleaned: a wrong-but-
 * plausible name on a bid document is worse than a generic one.
 */
/**
 * A name taken from what the document says at the top of page one.
 *
 * Last resort before giving up on a real name. A scanned or exported
 * solicitation attachment frequently carries no Title metadata at all, which
 * is how ten documents survived two backfills still called "attachment", but
 * the page itself almost always announces what it is: "STATEMENT OF WORK",
 * "Wage Determination", "Past Performance Questionnaire".
 *
 * The filtering is the whole job. The first lines of a federal PDF are mostly
 * furniture, page numbers, dates, bare form numbers, agency codes, and any of
 * them would make a worse name than "attachment" does.
 */
export function filenameFromPdfHeading(text: string | null | undefined): string | null {
  if (!text) return null;
  const lines = text
    .split("\n")
    .slice(0, 40)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  for (const line of lines) {
    // Page furniture: "Page 1 of 12", "1", "Rev. 3", a bare date.
    if (/^page\s+\d+(\s+of\s+\d+)?$/i.test(line)) continue;
    if (/^\d{1,4}$/.test(line)) continue;
    if (/^rev(ision)?\.?\s*\d/i.test(line)) continue;
    if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(line)) continue;
    // A bare form or solicitation number is an identifier, not a name.
    if (/^[A-Z0-9][A-Z0-9.\-_/ ]{2,}$/.test(line) && !/[a-z]/.test(line)) {
      const words = line.split(" ").filter((w) => /[A-Z]{3,}/.test(w));
      // "SOLICITATION OFFER AND AWARD" is upper case and a real heading;
      // "FA524026Q0021" and "SF 1449" are not.
      if (words.length < 2) continue;
    }
    // Too short to mean anything, or an abstract rather than a heading.
    if (line.length < 8 || line.length > 120) continue;
    const letters = line.replace(/[^A-Za-z]/g, "").length;
    if (letters < 6) continue;
    if (line.split(" ").length < 2) continue;

    const named = filenameFromPdfTitle(line);
    if (named) return named;
  }
  return null;
}

/**
 * The name a document gets when nothing in it or about it will say.
 *
 * Not a recovered name, a manufactured one, and deliberately so: "attachment"
 * tells the operator nothing and looks identical to every other unnamed file,
 * while the solicitation number and a position at least say which bid it
 * belongs to and distinguishes it from its siblings. Used only after the URL,
 * the PDF title, and the page heading have all failed.
 */
export function filenameFromSolicitation(input: {
  solicitationNumber?: string | null;
  opportunityTitle?: string | null;
  index: number;
  mime?: string | null;
}): string | null {
  const ref =
    input.solicitationNumber?.trim() ||
    (input.opportunityTitle?.trim() ? input.opportunityTitle.trim().slice(0, 60) : "");
  if (!ref) return null;
  const stem = `${ref} attachment ${input.index}`;
  return normalizeAttachmentMeta({ filename: stem, mime: input.mime ?? null }).filename;
}

export function filenameFromPdfTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  let t = title.trim();
  // Authoring-tool prefixes: "Microsoft Word - X", "PowerPoint Presentation - X".
  t = t.replace(/^(microsoft\s+(word|excel|powerpoint)|libreoffice\s+\w+)\s*[-\u2013:]\s*/i, "");
  // A title that is itself a filename: keep the stem, the caller re-extensions.
  t = t.replace(/\.(docx?|xlsx?|pptx?|pdf|rtf|txt)$/i, "");
  // Punctuation the filename sanitizer would turn into underscores; a title
  // reads better without it than with "Work_ Building".
  t = t.replace(/[,;:]/g, "").replace(/\s{2,}/g, " ").trim();
  if (t.length < 6) return null;
  // "Document1", "untitled 2", "draft" and friends: placeholder titles the
  // authoring tool invented, not names. Two optional halves so the common
  // two-word forms are caught as well: the previous pattern anchored a single
  // word followed by digits, so "Untitled document", which is what Word calls
  // every file nobody named, sailed through and became a filename.
  // [\s\d]* rather than \b because "Document1" has no word boundary before
  // the digit.
  if (
    /^(untitled|new|blank|draft|temp|scan|final|copy)?[\s\d]*(document|doc|presentation|workbook|spreadsheet|file|scan)?[\s\d]*$/i.test(
      t
    )
  ) {
    return null;
  }
  // Titles are prose-ish; anything absurdly long is an abstract, not a name.
  if (t.length > 120) t = `${t.slice(0, 117).trimEnd()}...`;
  const safe = sanitizeAttachmentFilename(t);
  return safe === "attachment" ? null : safe;
}

const ARCHIVE_RE = /\.(zip|rar|7z|tar|tgz|gz)$/i;
const ARCHIVE_MIME_RE = /zip|x-rar|x-7z|x-tar|gzip/i;

/**
 * Is this a container of documents rather than a document?
 *
 * Nothing in this codebase extracts archives, so the distinction is not
 * cosmetic. An archive reported as a successfully collected attachment is an
 * opportunity advancing into sourcing with every requirement inside it unread.
 *
 * Checks the name as well as the content type because SAM's own metadata calls
 * almost everything `application/octet-stream`.
 */
export function isArchive(name: string, contentType: string): boolean {
  return ARCHIVE_RE.test(name.trim()) || ARCHIVE_MIME_RE.test(contentType ?? "");
}
