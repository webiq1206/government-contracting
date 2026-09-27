/** A quote extractor may copy a stated amount, never silently calculate one. */
export function sourceMoneyValues(text: string): number[] {
  return [...text.matchAll(/(?:\$|\bUSD\s*)(\s*\d+(?:,\d{3})*(?:\.\d{1,2})?)(?![\d,]|\.\d|\s*[kKmM]\b)/gi)]
    .map(m => Number(m[1].replace(/[\s,]/g, "")))
    .filter(Number.isFinite);
}

export function groundedMoney(value: number | null, source: string): number | null {
  if (value == null || !Number.isFinite(value) || value < 0 || value > 100_000_000) return null;
  const cents = Math.round(value * 100);
  if (Math.abs(value * 100 - cents) > 0.00001) return null;
  return sourceMoneyValues(source).some(n => Math.round(n * 100) === cents) ? cents / 100 : null;
}

export function quoteHasRange(source: string): boolean {
  return /(?:\$|USD\s*)\s*[\d,.]+\s*(?:-|\u2013|to|through)\s*(?:\$|USD\s*)?\s*[\d,.]+/i.test(source)
    || /between\s+(?:\$|USD\s*)\s*[\d,.]+\s+and\s+(?:\$|USD\s*)?\s*[\d,.]+/i.test(source);
}
