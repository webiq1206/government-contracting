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
