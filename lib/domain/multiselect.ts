/**
 * Pure helpers for the token multi-select (search-and-pick chips backed by a CSV
 * string). Kept here and unit-tested so the filtering/add/remove behavior is
 * verified independently of the React component and the browser.
 */
export interface TokenOption {
  value: string;
  label: string;
}

/** Split a comma-separated value into trimmed, non-empty tokens. */
export function parseTokens(csv: string): string[] {
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Join tokens back into the CSV string the profile form stores. */
export function joinTokens(tokens: string[]): string {
  return tokens.join(", ");
}

/**
 * Options to offer for a query, excluding already-selected values. An empty
 * query returns the first `limit` unselected options; otherwise matches by
 * value OR label (case-insensitive substring), so a NAICS entry is found by
 * code or by keyword.
 */
export function matchOptions(
  options: TokenOption[],
  query: string,
  selected: string[],
  limit = 10
): TokenOption[] {
  const selectedSet = new Set(selected.map((s) => s.toLowerCase()));
  const needle = query.trim().toLowerCase();
  const unselected = options.filter((o) => !selectedSet.has(o.value.toLowerCase()));
  if (!needle) return unselected.slice(0, limit);
  return unselected
    .filter(
      (o) => o.value.toLowerCase().includes(needle) || o.label.toLowerCase().includes(needle)
    )
    .slice(0, limit);
}

/** Add a token if non-empty and not already present (case-insensitive). */
export function addToken(selected: string[], token: string): string[] {
  const t = token.trim();
  if (!t || selected.some((s) => s.toLowerCase() === t.toLowerCase())) return selected;
  return [...selected, t];
}

/** Remove a token (case-insensitive). */
export function removeToken(selected: string[], token: string): string[] {
  return selected.filter((s) => s.toLowerCase() !== token.toLowerCase());
}
