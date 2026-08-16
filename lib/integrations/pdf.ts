/**
 * PDF text extraction. Uses `unpdf` (a serverless-friendly build of pdf.js, no
 * native binaries, works on Replit). Dynamically imported so a missing/broken
 * install degrades to an empty string rather than crashing an agent.
 */
export async function extractPdfText(
  data: Uint8Array | Buffer,
  maxChars = 14_000
): Promise<{ text: string; pages: number }> {
  try {
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
    const { getMeta, getDocumentProxy } = await import("unpdf");
    const bytes =
      data.constructor === Uint8Array ? (data as Uint8Array) : new Uint8Array(data);
    const meta = await getMeta(await getDocumentProxy(bytes));
    const title = (meta?.info as { Title?: unknown } | undefined)?.Title;
    return typeof title === "string" && title.trim() ? title.trim() : null;
  } catch {
    return null;
  }
}
