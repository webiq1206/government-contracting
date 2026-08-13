/**
 * Reading quotes that arrive as attachments.
 *
 * Many subcontractors do not type a price into an email; they attach a PDF and
 * write "see attached". Reading only the body throws that bid away, so any
 * document that could carry a quote is converted to text and appended to the
 * reply before extraction runs.
 *
 * Bounded on purpose. This runs inside a polling loop, so it caps how many
 * documents it opens and how much text it hands to the model.
 */
import { gmail, type GmailAttachmentRef } from "../integrations/gmail";
import { extractPdfText } from "../integrations/pdf";

/** How many attachments on one message are worth opening. */
const MAX_DOCS = 3;
/** Characters of extracted document text appended to the reply. */
const MAX_DOC_CHARS = 6000;

/**
 * Types a quote plausibly arrives in. Images are excluded deliberately: a
 * photographed quote needs OCR, which we do not run, and pretending to read
 * one would be worse than admitting we cannot.
 */
export function looksLikeQuoteDoc(a: GmailAttachmentRef): boolean {
  const name = a.filename.toLowerCase();
  const type = (a.mimeType ?? "").toLowerCase();
  if (type.includes("pdf") || name.endsWith(".pdf")) return true;
  // Signature logos and inline images slip through as attachments constantly.
  if (type.startsWith("image/")) return false;
  return /\.(txt|csv)$/.test(name);
}

export interface AttachmentReadResult {
  /** Extracted text, ready to append to the reply body. */
  text: string;
  /** Filenames actually read, for the audit trail. */
  read: string[];
  /**
   * Attachments that look like a quote but could not be read (a scan, an
   * unsupported format, a download failure). Surfaced rather than swallowed:
   * the operator needs to know a document was present and unread.
   */
  unreadable: string[];
}

/**
 * Pull readable text out of a reply's attachments.
 *
 * Never throws. A document that cannot be read is reported, not fatal: losing
 * the whole reply because one PDF was malformed would be a worse failure.
 */
export async function readReplyAttachments(input: {
  messageId: string;
  attachments: GmailAttachmentRef[];
  orgId?: string | null;
}): Promise<AttachmentReadResult> {
  const candidates = input.attachments.filter(looksLikeQuoteDoc);
  if (candidates.length === 0) return { text: "", read: [], unreadable: [] };

  const read: string[] = [];
  const unreadable: string[] = [];
  const chunks: string[] = [];

  for (const a of candidates.slice(0, MAX_DOCS)) {
    const buf = await gmail.getAttachment(
      input.messageId,
      a.attachmentId,
      input.orgId ?? undefined
    );
    if (!buf) {
      unreadable.push(a.filename);
      continue;
    }

    let text = "";
    const isPdf = /pdf/i.test(a.mimeType) || /\.pdf$/i.test(a.filename);
    if (isPdf) {
      const res = await extractPdfText(buf, MAX_DOC_CHARS);
      text = res.text;
    } else {
      text = buf.toString("utf8").slice(0, MAX_DOC_CHARS);
    }

    // A PDF of a scanned page extracts to nothing. Calling that "read" would
    // tell the operator we looked at a quote we never saw.
    if (text.trim().length < 20) {
      unreadable.push(a.filename);
      continue;
    }
    read.push(a.filename);
    chunks.push(`--- Attached document: ${a.filename} ---\n${text}`);
  }

  // Anything beyond the cap was never opened; say so rather than implying it.
  for (const a of candidates.slice(MAX_DOCS)) unreadable.push(a.filename);

  return {
    text: chunks.join("\n\n").slice(0, MAX_DOC_CHARS * MAX_DOCS),
    read,
    unreadable,
  };
}

/**
 * Combine the email body with any document text, labelled so the model knows
 * which is which. A price in an attached quote and a price typed in the body
 * carry different weight, and the model cannot weigh them if it cannot tell
 * them apart.
 */
export function combineReplyText(body: string, attachmentText: string): string {
  if (!attachmentText) return body;
  return `${body}\n\n${attachmentText}`;
}
