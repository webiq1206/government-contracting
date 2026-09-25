/**
 * Shorten a sentence for a summary line without cutting a word in half.
 *
 * The recap used to slice error text at a fixed character count, so the
 * morning mail ended lines with "review limits or res" and "request-count
 * lim". A clipped sentence should end at a word and say that it was clipped.
 */
export function clipText(text: string | null | undefined, max = 200): string | undefined {
  if (text == null) return undefined;
  const clean = String(text).replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const atWord = cut.lastIndexOf(" ");
  const kept = atWord > max * 0.6 ? cut.slice(0, atWord) : cut;
  return `${kept.replace(/[\s,;:]+$/, "")}...`;
}
