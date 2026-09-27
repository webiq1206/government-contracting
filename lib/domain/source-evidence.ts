import { noEmDash } from "../sanitize";

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
  const normalize = (s: string) => noEmDash(s).replace(/\s+/g, " ").trim();
  return normalize(text).includes(normalize(quote));
}
