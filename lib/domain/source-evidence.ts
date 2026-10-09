import { noEmDash } from "../sanitize";

const normalize = (text: string) => noEmDash(text).replace(/\s+/g, " ").trim();

/** Verify an excerpt against its actual document/page, not the model's assertion. */
export function sourceEvidenceMatches(source: string, quote: string | undefined, page?: number | null): boolean {
  if (!quote?.trim()) return false;
  let text = source;
  if (page != null) {
    const markers = [...source.matchAll(/\[p\.(\d+)\]/g)];
    const index = markers.findIndex(m => Number(m[1]) === page);
    if (index < 0) return false;
    const marker = markers[index];
    text = source.slice(marker.index! + marker[0].length, markers[index + 1]?.index ?? source.length);
  }
  return normalize(text).includes(normalize(quote));
}

/** Locate a quotation using extractor page boundaries, never markers in document text. */
export function verifiedSourcePage(pages: readonly string[] | undefined, quote: string | undefined, recordedPage?: number | null): number | undefined {
  if (!pages || !quote?.trim()) return undefined;
  const excerpt = normalize(quote);
  const matches = pages.flatMap((text, index) => normalize(text).includes(excerpt) ? [index + 1] : []);
  // A repeated header does not identify a new location. Keep the requested
  // page only when the actual quotation is present there.
  if (recordedPage != null && matches.includes(recordedPage)) return recordedPage;
  return matches.length === 1 ? matches[0] : undefined;
}
