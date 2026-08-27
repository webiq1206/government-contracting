/**
 * Search results, grouped and made safe to render.
 *
 * Two things this module exists for.
 *
 * The first is grouping. A flat list with a small badge on each row makes the
 * reader do the sorting: they scan nineteen rows looking for the one
 * subcontractor among the opportunities. The audit asks for groups, and the
 * counts per group are what tell somebody their search matched four
 * communications they had not thought to look for.
 *
 * The second is highlighting, which is where searching gets dangerous. The
 * matched text comes from customer records, so building the highlight as HTML
 * would be an injection hole in the one place every record in the account
 * passes through. This splits the string into plain segments instead and lets
 * the renderer decide what to do with them, so there is nothing to escape.
 */

export type ResultKind =
  | "opportunity"
  | "subcontractor"
  | "contract"
  | "communication"
  | "document";

export interface SearchResult {
  kind: ResultKind;
  title: string;
  subtitle: string;
  href: string;
  /**
   * Set when this row stands for more than one record of the same thing.
   *
   * A folded duplicate is a data-quality fact, and showing one of three
   * silently makes the other two look like they do not exist. The count says
   * how many were folded; the href opens all of them side by side so the
   * operator can see which stage each is at and close the wrong ones.
   */
  cluster?: { count: number; href: string };
}

export const KIND_LABEL: Record<ResultKind, string> = {
  opportunity: "Opportunity",
  subcontractor: "Subcontractor",
  contract: "Contract",
  communication: "Message",
  document: "Document",
};

export const KIND_PLURAL: Record<ResultKind, string> = {
  opportunity: "Opportunities",
  subcontractor: "Subcontractors",
  contract: "Contracts",
  communication: "Messages",
  document: "Documents",
};

/** The order the audit lists, which is also roughly how often each is wanted. */
export const KIND_ORDER: ResultKind[] = [
  "opportunity",
  "subcontractor",
  "contract",
  "communication",
  "document",
];

export interface ResultGroup {
  kind: ResultKind;
  label: string;
  results: SearchResult[];
}

export function groupResults(results: SearchResult[]): ResultGroup[] {
  return KIND_ORDER.map((kind) => ({
    kind,
    label: KIND_PLURAL[kind],
    results: results.filter((r) => r.kind === kind),
  })).filter((g) => g.results.length > 0);
}

export interface Segment {
  text: string;
  match: boolean;
}

/**
 * Splits a string around every occurrence of the query, case-insensitively.
 *
 * Plain segments rather than markup: the input is a customer's own record
 * text, and returning HTML from here would put an injection hole in the one
 * path every record in the account travels through. The renderer wraps the
 * matched segments in an element, so nothing is ever parsed as markup.
 */
export function highlight(text: string, query: string): Segment[] {
  const t = text ?? "";
  const q = (query ?? "").trim();
  if (!q || !t) return [{ text: t, match: false }];
  const out: Segment[] = [];
  const lowerT = t.toLowerCase();
  const lowerQ = q.toLowerCase();
  let from = 0;
  for (;;) {
    const at = lowerT.indexOf(lowerQ, from);
    if (at < 0) break;
    if (at > from) out.push({ text: t.slice(from, at), match: false });
    out.push({ text: t.slice(at, at + q.length), match: true });
    from = at + q.length;
  }
  if (from < t.length) out.push({ text: t.slice(from), match: false });
  return out.length > 0 ? out : [{ text: t, match: false }];
}

/** A short window of a long body around the first match, so a message is readable. */
export function snippet(text: string, query: string, radius = 60): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  const q = (query ?? "").trim();
  // Truncating without saying so hides that there is more, which is the same
  // small dishonesty as every other silent cut in this codebase.
  const opening = () =>
    t.length > radius * 2 ? `${t.slice(0, radius * 2)}…` : t;
  if (!q) return opening();
  const at = t.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return opening();
  const start = Math.max(0, at - radius);
  const end = Math.min(t.length, at + q.length + radius);
  return `${start > 0 ? "…" : ""}${t.slice(start, end)}${end < t.length ? "…" : ""}`;
}

/**
 * What to suggest when nothing matched.
 *
 * The audit asks for suggested corrections, and the honest kind is not a
 * spell-checker: it is telling somebody what this search actually looks at,
 * because the commonest reason for no results is looking for something that
 * was never indexed. Anything more clever would guess at intent.
 */
export function noResultAdvice(query: string): string[] {
  const q = query.trim();
  const out: string[] = [];
  if (q.length < 4) {
    out.push("Try more of the word. Very short searches match too much or nothing at all.");
  }
  if (/\d/.test(q) && /[^\d\s-]/.test(q)) {
    out.push("If this is a solicitation number, try just the number without the agency prefix.");
  }
  if (q.includes("@")) {
    out.push("Searching by email address finds the subcontractor, not the message. Try the company name.");
  }
  if (/\s/.test(q)) {
    out.push("Try one distinctive word rather than the whole phrase.");
  }
  out.push(
    "This searches opportunity titles, solicitation numbers, agencies, subcontractor and owner names, contract numbers, message subjects and bodies, and document names."
  );
  return out;
}
