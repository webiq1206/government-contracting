/**
 * PDF text extraction. Uses `unpdf` (a serverless-friendly build of pdf.js, no
 * native binaries, works on Replit). Dynamically imported so a missing/broken
 * install degrades to an empty string rather than crashing an agent.
 */

/**
 * pdf.js, bundled inside unpdf, calls `Promise.withResolvers()`. That landed
 * in Node 22, which is why unpdf declares `engines: node >= 22`; this project
 * deploys on Node 20. Every extraction therefore threw "Promise.withResolvers
 * is not a function" and, because both entry points swallow errors, failed
 * silently: the document-name backfill reported a bare "failed" for each file
 * whose name had to come from PDF metadata.
 *
 * The shim is the spec's four lines and installs only when the runtime lacks
 * it, so Node 22+ keeps its native implementation untouched. Exported so the
 * behaviour is testable without deleting a global in a live process.
 */
export function ensurePromiseWithResolvers(): void {
  const P = Promise as unknown as {
    withResolvers?: <T>() => {
      promise: Promise<T>;
      resolve: (value: T | PromiseLike<T>) => void;
      reject: (reason?: unknown) => void;
    };
  };
  if (typeof P.withResolvers === "function") return;
  P.withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}
export async function extractPdfText(
  data: Uint8Array | Buffer,
  maxChars = 14_000
): Promise<{ text: string; pages: number }> {
  try {
    ensurePromiseWithResolvers();
    const { extractText, getDocumentProxy } = await import("unpdf");
    // pdf.js/unpdf reject a Node Buffer specifically, coerce to a plain Uint8Array.
    const bytes =
      data.constructor === Uint8Array ? (data as Uint8Array) : new Uint8Array(data);
    const pdf = await getDocumentProxy(bytes);
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    const merged = Array.isArray(text) ? text.join("\n") : text;
    return { text: normalize(merged).slice(0, maxChars), pages: totalPages };
  } catch (err) {
    console.warn("[pdf] extraction failed:", (err as Error).message);
    return { text: "", pages: 0 };
  }
}

/**
 * The same text, still divided by page.
 *
 * `extractPdfText` merges every page into one string, which is fine for
 * reading and useless for citing: a requirement extracted from a
 * two-hundred-page specification could be attributed to the document but never
 * to a page, so "open the source" meant "open the file and start looking".
 *
 * Pages are returned as they are, empty ones included, so the index of a page
 * in this array is its real page number minus one. Dropping blanks would
 * renumber every page after the first blank, and a citation that points at the
 * wrong page is worse than no citation, because it will be believed.
 */
export async function extractPdfPages(
  data: Uint8Array | Buffer,
  maxChars = 400_000
): Promise<{ pages: string[]; total: number }> {
  try {
    ensurePromiseWithResolvers();
    const { extractText, getDocumentProxy } = await import("unpdf");
    const bytes = data.constructor === Uint8Array ? (data as Uint8Array) : new Uint8Array(data);
    const pdf = await getDocumentProxy(bytes);
    const { text, totalPages } = await extractText(pdf, { mergePages: false });
    const raw = Array.isArray(text) ? text : [String(text ?? "")];
    const pages: string[] = [];
    let used = 0;
    for (const page of raw) {
      if (used >= maxChars) {
        // Out of budget. Every remaining page is present and empty rather
        // than absent, so page numbers stay true and the caller can see how
        // much of the document it is holding.
        pages.push("");
        continue;
      }
      const cleaned = normalize(page ?? "").slice(0, Math.max(0, maxChars - used));
      used += cleaned.length;
      pages.push(cleaned);
    }
    return { pages, total: totalPages };
  } catch (err) {
    console.warn("[pdf] page extraction failed:", (err as Error).message);
    return { pages: [], total: 0 };
  }
}

function normalize(s: string): string {
  return s
    .replace(/\r/g, "")
    .replace(/ /g, " ") // non-breaking space -> normal space
    .replace(/[ \t]{2,}/g, " ") // collapse runs of spaces/tabs
    .replace(/[ \t]+\n/g, "\n") // trim trailing whitespace per line
    .replace(/\n{3,}/g, "\n\n") // cap blank-line runs
    .trim();
}

export function looksLikePdf(url: string, contentType: string): boolean {
  return contentType.includes("pdf") || /\.pdf(\?|$)/i.test(url);
}

/**
 * Sniff the actual file bytes for the PDF magic number ("%PDF-"). SAM.gov's
 * attachment endpoint serves virtually every file, PDF included, as
 * `content-type: application/octet-stream` behind an opaque URL with no file
 * extension, so looksLikePdf() (header/URL based) misses almost all of them
 * and every real attachment fell through to "binary, not text-parseable"
 * with zero characters extracted. The magic number is authoritative
 * regardless of what the server's headers claim.
 */
export function looksLikePdfBytes(data: Uint8Array | Buffer): boolean {
  if (data.length < 5) return false;
  return (
    data[0] === 0x25 && // %
    data[1] === 0x50 && // P
    data[2] === 0x44 && // D
    data[3] === 0x46 && // F
    data[4] === 0x2d // -
  );
}

/**
 * The document's own title, from PDF metadata.
 *
 * Last resort for naming: used when the download URL has expired so the
 * server can no longer say the filename, but the bytes are already in
 * storage. Returns the raw Title string or null; deciding whether it makes a
 * usable filename is filenameFromPdfTitle's job, which is pure and tested.
 */
export async function extractPdfTitle(data: Uint8Array | Buffer): Promise<string | null> {
  try {
    ensurePromiseWithResolvers();
    const { getMeta, getDocumentProxy } = await import("unpdf");
    const bytes =
      data.constructor === Uint8Array ? (data as Uint8Array) : new Uint8Array(data);
    const meta = await getMeta(await getDocumentProxy(bytes));
    const title = (meta?.info as { Title?: unknown } | undefined)?.Title;
    return typeof title === "string" && title.trim() ? title.trim() : null;
  } catch (err) {
    // Silence here is what hid the Node 20 incompatibility for two rounds of
    // the backfill; a title we cannot read is normal, but say why.
    console.warn("[pdf] title read failed:", (err as Error).message);
    return null;
  }
}
