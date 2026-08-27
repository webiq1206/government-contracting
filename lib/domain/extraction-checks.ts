/**
 * Checking the extraction against the document it came from.
 *
 * A language model asked for a deadline returns a deadline. Asked for a list
 * of clauses it returns a list of clauses. Nothing in a valid JSON response
 * says whether any of it is in the file, and the instructions this implements
 * are explicit that valid JSON is not completeness.
 *
 * Some things in a solicitation have a shape a regular expression can find
 * exactly: FAR clause numbers, CLINs, page limits, dates. Where a deterministic
 * reading and the model disagree, that disagreement is the finding. It is
 * surfaced, never silently resolved: overwriting the model with a regex would
 * trade one unverified answer for another, and picking the regex because it
 * feels more solid is how a "52.212-1" mentioned in passing becomes a
 * requirement nobody has.
 *
 * Pure. Every function here takes text and returns findings.
 */

export interface Clause {
  /** As written: "52.212-4", "252.204-7012". */
  id: string;
  /** FAR or DFARS, inferred from the number's shape. */
  regulation: "FAR" | "DFARS";
  /** Where it was found, when the text carries page markers. */
  page: number | null;
}

/**
 * FAR clauses are `52.xxx-x`; DFARS are `252.xxx-xxxx`. Both take an optional
 * alternate ("52.212-4 Alt I"), which is a different clause with different
 * obligations and is kept rather than normalized away.
 */
const CLAUSE_RE = /\b(2?52)\.(\d{3})-(\d{1,4})(\s+Alt(?:ernate)?\s+([IVX]+))?/gi;

export function extractClauses(text: string): Clause[] {
  const found = new Map<string, Clause>();
  for (const m of text.matchAll(CLAUSE_RE)) {
    const alt = m[5] ? ` Alt ${m[5].toUpperCase()}` : "";
    const id = `${m[1]}.${m[2]}-${m[3]}${alt}`;
    if (!found.has(id)) {
      found.set(id, {
        id,
        regulation: m[1] === "252" ? "DFARS" : "FAR",
        page: pageOf(text, m.index ?? 0),
      });
    }
  }
  return [...found.values()];
}

/**
 * The page a match sits on, from the nearest `[p.N]` marker before it.
 *
 * Null when the text carries no markers, which is honest: a document with no
 * page structure has no page to cite, and returning 1 would be a guess
 * dressed as a fact.
 */
export function pageOf(text: string, index: number): number | null {
  const before = text.slice(0, index);
  const last = before.lastIndexOf("[p.");
  if (last === -1) return null;
  const m = /^\[p\.(\d+)\]/.exec(before.slice(last));
  return m ? Number(m[1]) : null;
}

export interface PageLimit {
  /** The section or volume it applies to, as written. Null when unqualified. */
  applesTo: string | null;
  pages: number;
  page: number | null;
}

/**
 * "shall not exceed 20 pages", "limited to ten (10) pages", "maximum of 5
 * pages". Page limits get bids thrown out and are stated in a small number of
 * forms, which makes them worth reading exactly.
 */
/*
 * The optional word before the number is letters only, deliberately.
 *
 * It is there for "limited to ten (10) pages", where the digits follow a
 * spelled-out number. Written as `\w+` it also matches digits, so it ate the
 * number itself in "shall not exceed 20 pages" and the pattern then found
 * nothing at all: a page limit silently missed is worse than one never looked
 * for, because the search reports success.
 */
const PAGE_LIMIT_RE =
  /(?:not\s+exceed|no\s+more\s+than|limited\s+to|maximum\s+of|max(?:imum)?)\s+(?:[a-z]+[\s-]*)?\(?(\d{1,3})\)?\s*(?:single|double)?[-\s]?(?:sided\s+)?pages?/gi;

export function extractPageLimits(text: string): PageLimit[] {
  const out: PageLimit[] = [];
  for (const m of text.matchAll(PAGE_LIMIT_RE)) {
    const pages = Number(m[1]);
    if (!Number.isFinite(pages) || pages <= 0 || pages > 500) continue;
    /*
     * The nearest heading before the limit, not the first one in the window.
     *
     * Taking the first match attributed "Past Performance is limited to 5
     * pages" to the Technical Volume mentioned earlier in the same paragraph,
     * which is the one way this could produce a confident wrong answer rather
     * than no answer.
     */
    const context = text.slice(Math.max(0, (m.index ?? 0) - 120), m.index ?? 0);
    const headings = [
      ...context.matchAll(/(Volume\s+[IVX0-9]+|Technical\s+\w+|Price\s+\w+|Past\s+Performance)/gi),
    ];
    const volume = headings.length > 0 ? headings[headings.length - 1] : null;
    out.push({
      applesTo: volume ? volume[1] : null,
      pages,
      page: pageOf(text, m.index ?? 0),
    });
  }
  return out;
}

export interface Contradiction {
  kind: "page_limit" | "deadline" | "clause_missing";
  /** One sentence naming the disagreement, for an operator to settle. */
  detail: string;
}

/**
 * Two different page limits for the same thing.
 *
 * Common and consequential: the base solicitation says twenty pages, an
 * amendment says ten, and the amendment is the one that counts. Nothing here
 * decides which is right, because the answer depends on which document is
 * current and that is a judgement about the solicitation, not about text.
 */
export function pageLimitContradictions(limits: readonly PageLimit[]): Contradiction[] {
  const byTarget = new Map<string, Set<number>>();
  for (const l of limits) {
    const key = (l.applesTo ?? "the proposal").toLowerCase();
    const set = byTarget.get(key) ?? new Set<number>();
    set.add(l.pages);
    byTarget.set(key, set);
  }
  const out: Contradiction[] = [];
  for (const [target, pages] of byTarget) {
    if (pages.size > 1) {
      const sorted = [...pages].sort((a, b) => a - b);
      out.push({
        kind: "page_limit",
        detail: `The documents give more than one page limit for ${target}: ${sorted.join(" and ")}. Confirm which applies before the package is built.`,
      });
    }
  }
  return out;
}

export interface RequirementLike {
  id: string;
  title: string;
  officialForm?: string;
  mandatory?: boolean;
}

export interface DuplicateGroup {
  /** The one to keep: the first seen, which is the model's own ordering. */
  keep: RequirementLike;
  drop: RequirementLike[];
  why: string;
}

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    // Words that describe how a requirement is satisfied rather than what it
    // is. "Signed SF-1449" and "SF-1449 offer form" are one requirement.
    .replace(/\b(signed|completed|executed|fully|the|a|an|copy|of|form|and|dated)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The same requirement, listed twice under different words.
 *
 * A compliance matrix with "Signed SF-1449" and "SF-1449 offer form" in it
 * makes an operator do one job twice and makes the package validator demand
 * two files where one exists.
 *
 * Two requirements are the same when they name the same official form, or when
 * their titles reduce to the same words. Nothing merges on a partial match:
 * "Bid bond" and "Payment bond" reduce to different words and are genuinely
 * different documents, and a merge that guesses is worse than a list that
 * repeats itself.
 */
export function findDuplicateRequirements(
  requirements: readonly RequirementLike[]
): DuplicateGroup[] {
  const byForm = new Map<string, RequirementLike[]>();
  const byTitle = new Map<string, RequirementLike[]>();
  for (const r of requirements) {
    const form = r.officialForm?.trim().toLowerCase();
    if (form) {
      byForm.set(form, [...(byForm.get(form) ?? []), r]);
    } else {
      const key = normalizeTitle(r.title);
      if (key) byTitle.set(key, [...(byTitle.get(key) ?? []), r]);
    }
  }
  const groups: DuplicateGroup[] = [];
  for (const [form, rs] of byForm) {
    if (rs.length > 1) {
      groups.push({
        keep: rs[0],
        drop: rs.slice(1),
        why: `All name the same form (${form.toUpperCase()}).`,
      });
    }
  }
  for (const [, rs] of byTitle) {
    if (rs.length > 1) {
      groups.push({
        keep: rs[0],
        drop: rs.slice(1),
        why: "Different wording for the same requirement.",
      });
    }
  }
  return groups;
}

/**
 * Drop the duplicates, keeping the strictest version of each.
 *
 * "Strictest" means mandatory wins: if the same requirement appears once as
 * required and once as optional, dropping the required one would turn a
 * disqualifier into a suggestion. That is the only merge rule here, because it
 * is the only one where getting it wrong is not symmetrical.
 */
export function dedupeRequirements<T extends RequirementLike>(requirements: readonly T[]): T[] {
  const groups = findDuplicateRequirements(requirements);
  const dropped = new Set(groups.flatMap((g) => g.drop.map((d) => d.id)));
  const mandatoryIn = new Set<string>();
  for (const g of groups) {
    if ([g.keep, ...g.drop].some((r) => r.mandatory)) mandatoryIn.add(g.keep.id);
  }
  return requirements
    .filter((r) => !dropped.has(r.id))
    .map((r) => (mandatoryIn.has(r.id) && !r.mandatory ? { ...r, mandatory: true } : r));
}
