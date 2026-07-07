/**
 * Text sanitizer that enforces the absolute no-em-dash rule. Em dashes (and the
 * visually similar en dash) read as machine-generated and are never allowed in
 * generated bid documents or stored AI output. A spaced dash in prose becomes a
 * comma; any other dash becomes a hyphen.
 *
 * This is applied at two choke points:
 *  1. Every string rendered into a generated PDF/DOCX (guarantee for bids).
 *  2. AI output before it is stored (analysis, narrative, audit findings).
 */
export function noEmDash(input: string): string {
  if (!input) return input;
  return input
    .replace(/\s+[—–]\s+/g, ", ") // "word — word" -> "word, word"
    .replace(/[—–]/g, "-"); // any remaining em/en dash -> hyphen
}

/** Recursively strip em dashes from every string in a JSON-serializable value. */
export function deepNoEmDash<T>(value: T): T {
  if (typeof value === "string") return noEmDash(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => deepNoEmDash(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = deepNoEmDash(v);
    }
    return out as T;
  }
  return value;
}
