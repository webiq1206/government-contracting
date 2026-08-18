/**
 * OCR for scanned, image-only PDFs.
 *
 * Roughly a third of the solicitations that matter, especially from smaller
 * contracting offices, are scans: paper that was fed through a copier and
 * posted as a PDF with no text layer at all. unpdf extracts nothing from
 * those, so before this existed the analyst saw "PDF stored but no extractable
 * text" and the compliance matrix was built from the portal blurb alone, or
 * worse, from the model's idea of what a solicitation like this usually asks
 * for. Section L can say "submit four copies, tabbed, with a two-page past
 * performance summary" and none of it would ever reach the package.
 *
 * The read is done by Claude directly on the PDF bytes (native document
 * blocks), which needs no OCR binary, no rasterizer, and no canvas
 * dependency, none of which are installable on the deploy target.
 *
 * ACCURACY IS THE WHOLE POINT. The prompt is a transcription instruction, not
 * a summarization one: reproduce what is on the page, mark what cannot be
 * read, and never supply a plausible-looking value for a smudged one. Text
 * that comes back from here is labelled as transcribed so that everything
 * downstream, and the operator, can tell it apart from a real text layer.
 */
import { PDFDocument } from "pdf-lib";
import { complete, ClaudeNotConfiguredError } from "../ai/claude";

/**
 * Pages per request. The API accepts far more, but a scanned page is a full
 * image: smaller batches keep each request well inside the 32MB request cap,
 * keep the transcription from running into the output ceiling, and mean one
 * bad page loses one batch instead of the whole document.
 */
const PAGES_PER_BATCH = 15;

/** Ceiling on how much of one attachment gets transcribed. */
const MAX_OCR_PAGES = 90;

/** Output budget per batch. Dense scanned pages run ~1,200 tokens each. */
const MAX_TOKENS_PER_BATCH = 16_000;

const TRANSCRIBE_PROMPT = [
  "The attached pages are a scanned government solicitation document with no text layer.",
  "Transcribe them. This is a transcription task, not a summary and not an analysis.",
  "",
  "Rules, follow exactly:",
  "1. Reproduce the text on the page, in reading order, as close to verbatim as you can.",
  "2. Never add, complete, correct, standardize or infer anything. If the page says \"SF-l449\" with a lowercase L, write what you see. If a sentence is cut off, leave it cut off.",
  "3. If a word, number, date or box is unreadable, write [illegible] in its place. NEVER guess a digit, dollar amount, date, form number, clause number or name. A missing value is correct; an invented one is not.",
  "4. If a page has no readable content at all (blank, or an image/drawing only), write \"[page N: no readable text]\" and briefly say what kind of image it is.",
  "5. Keep tables as text, one row per line, with columns separated by \" | \". Keep checkbox state as [x] or [ ] exactly as marked.",
  "6. Preserve section numbers, headings, form field labels and clause references exactly as printed.",
  "7. Start each page with a line \"--- page N ---\" using the page number printed on the page where there is one, otherwise its position in this batch.",
  "",
  "Output the transcription only. No preamble, no commentary, no closing summary.",
].join("\n");

export interface PdfOcrResult {
  /** Transcribed text, empty when nothing could be read. */
  text: string;
  /** Pages actually sent for transcription. */
  pagesRead: number;
  /** Pages in the document. */
  pagesTotal: number;
  /** True when the document was longer than the ceiling and was cut short. */
  truncated: boolean;
  /** Populated when OCR could not run at all. */
  error?: string;
}

/** Split a PDF into batches of at most `size` pages, each a standalone PDF. */
async function splitPages(
  bytes: Uint8Array,
  size: number,
  limit: number
): Promise<{ batches: Uint8Array[]; pagesTotal: number; pagesRead: number }> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pagesTotal = src.getPageCount();
  const pagesRead = Math.min(pagesTotal, limit);
  const batches: Uint8Array[] = [];
  for (let start = 0; start < pagesRead; start += size) {
    const indices: number[] = [];
    for (let i = start; i < Math.min(start + size, pagesRead); i++) indices.push(i);
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, indices);
    copied.forEach((p) => out.addPage(p));
    batches.push(await out.save());
  }
  return { batches, pagesTotal, pagesRead };
}

/**
 * Transcribe a scanned PDF. Never throws: a failure returns empty text with a
 * reason, so the caller reports "could not read" rather than pretending the
 * document was understood.
 */
export async function ocrPdf(
  data: Uint8Array | Buffer,
  opts: { label?: string; maxPages?: number; model?: string } = {}
): Promise<PdfOcrResult> {
  const bytes = data.constructor === Uint8Array ? (data as Uint8Array) : new Uint8Array(data);
  const limit = opts.maxPages ?? MAX_OCR_PAGES;
  let split: Awaited<ReturnType<typeof splitPages>>;
  try {
    split = await splitPages(bytes, PAGES_PER_BATCH, limit);
  } catch (err) {
    return {
      text: "",
      pagesRead: 0,
      pagesTotal: 0,
      truncated: false,
      error: `could not open the PDF (${(err as Error).message})`,
    };
  }

  const parts: string[] = [];
  let failures = 0;
  for (let i = 0; i < split.batches.length; i++) {
    const firstPage = i * PAGES_PER_BATCH + 1;
    try {
      const { text } = await complete(
        `${TRANSCRIBE_PROMPT}\n\nThese are pages ${firstPage} to ${Math.min(
          firstPage + PAGES_PER_BATCH - 1,
          split.pagesRead
        )} of ${split.pagesTotal}${opts.label ? ` of the document "${opts.label}"` : ""}.`,
        {
          // Base64 must carry no newlines; Buffer's base64 encoding has none.
          documents: [{ base64: Buffer.from(split.batches[i]).toString("base64") }],
          maxTokens: MAX_TOKENS_PER_BATCH,
          // The Company Profile is our own marketing copy. Injecting it into a
          // transcription prompt is the one thing most likely to make the model
          // "recognize" our own boilerplate on a page that does not contain it.
          injectProfile: false,
          model: opts.model,
        }
      );
      if (text.trim()) parts.push(text.trim());
    } catch (err) {
      if (err instanceof ClaudeNotConfiguredError) {
        return {
          text: "",
          pagesRead: 0,
          pagesTotal: split.pagesTotal,
          truncated: false,
          error: "AI is not configured for this organization, so scans cannot be read",
        };
      }
      failures++;
      console.error(
        `[pdf-ocr] batch starting at page ${firstPage} failed: ${(err as Error).message}`
      );
      // Say so in the text itself. A silently dropped batch is a hole in the
      // requirements that nothing downstream can see.
      parts.push(
        `--- pages ${firstPage} to ${Math.min(
          firstPage + PAGES_PER_BATCH - 1,
          split.pagesRead
        )}: could not be read ---`
      );
    }
  }

  const text = parts.join("\n\n");
  const readable = failures < split.batches.length && text.trim().length > 0;
  return {
    text: readable ? text : "",
    pagesRead: readable ? split.pagesRead : 0,
    pagesTotal: split.pagesTotal,
    truncated: split.pagesRead < split.pagesTotal,
    error: readable
      ? undefined
      : failures > 0
        ? "every page batch failed to transcribe"
        : "nothing readable was transcribed",
  };
}
