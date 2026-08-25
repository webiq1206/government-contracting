/**
 * Filtering, sorting and paging a table, decided in one place.
 *
 * Every list in this product grew its own version of this: the Sub Database
 * built a query string by hand in a client component, the Email Log did
 * something else, Platform Admin did a third thing. They disagreed about
 * blanks ("" versus absent), about how a cleared filter is removed, and about
 * whether the URL or a piece of component state was the truth -- which is how
 * a filtered list survives a back-button press showing rows that do not match
 * the controls above them.
 *
 * The rule here: the URL IS the state. A filtered, sorted, paged view is a
 * link. It survives refresh and Back, it can be pasted to a colleague, and the
 * server can render it without a round trip to find out what the client meant.
 * Preferences that are about the VIEWER rather than the data -- which columns,
 * how dense -- deliberately do not live in the URL; a shared link should not
 * impose the sender's column choices on the person opening it.
 *
 * Pure: no React, no database, no browser. The rules are testable on their own.
 */

export type FilterKind = "text" | "select" | "boolean" | "min";

export interface FilterSpec {
  /** Query-string key. Short, because these end up in shared links. */
  key: string;
  label: string;
  kind: FilterKind;
  /** Placeholder for text, or the "any" label for a select. */
  placeholder?: string;
  /** For kind "select": the allowed values. Anything else is ignored. */
  options?: { value: string; label: string }[];
  /** Uppercase on the way in (state codes). */
  upper?: boolean;
  /** For "min": bounds, used for validation and the input's own attributes. */
  min?: number;
  max?: number;
  /** Longer explanation, shown as a tooltip on the control. */
  hint?: string;
}

export type FilterValues = Record<string, string>;

/** Anything the caller might hand us for a query string. */
export type RawParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? "";
  return v ?? "";
}

/**
 * Read the filters out of a query string, keeping only what the specs allow.
 *
 * Unknown keys are dropped rather than passed through: a filter the page does
 * not understand cannot be shown in the toolbar, so honouring it silently
 * would produce a list the visible controls do not explain.
 */
export function parseFilters(specs: FilterSpec[], params: RawParams): FilterValues {
  const out: FilterValues = {};
  for (const spec of specs) {
    const raw = first(params[spec.key]).trim();
    if (!raw) continue;

    if (spec.kind === "boolean") {
      // Only an explicit "1" turns a boolean filter on. A stray "0" or "false"
      // in a hand-edited URL reads as off rather than as an error.
      if (raw === "1") out[spec.key] = "1";
      continue;
    }
    if (spec.kind === "min") {
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      const lo = spec.min ?? Number.NEGATIVE_INFINITY;
      const hi = spec.max ?? Number.POSITIVE_INFINITY;
      out[spec.key] = String(Math.min(hi, Math.max(lo, n)));
      continue;
    }
    if (spec.kind === "select") {
      // A value outside the option list is not a filter, it is a typo or a
      // stale link. Dropping it shows the full list rather than an empty one.
      if (spec.options?.some((o) => o.value === raw)) out[spec.key] = raw;
      continue;
    }
    out[spec.key] = spec.upper ? raw.toUpperCase() : raw;
  }
  return out;
}

export type SortDirection = "asc" | "desc";

export interface SortState {
  key: string | null;
  direction: SortDirection;
}

/**
 * Read the sort out of a query string. `sort=name` ascends, `sort=-name`
 * descends -- the leading minus is the convention every API that has ever
 * had to put a sort in a URL settled on, and it survives copy-paste.
 */
export function parseSort(params: RawParams, allowed: string[]): SortState {
  const raw = first(params.sort).trim();
  if (!raw) return { key: null, direction: "asc" };
  const desc = raw.startsWith("-");
  const key = desc ? raw.slice(1) : raw;
  if (!allowed.includes(key)) return { key: null, direction: "asc" };
  return { key, direction: desc ? "desc" : "asc" };
}

export function serializeSort(sort: SortState): string {
  if (!sort.key) return "";
  return sort.direction === "desc" ? `-${sort.key}` : sort.key;
}

/**
 * What clicking a column header should do next.
 *
 * First click sorts ascending, second flips to descending, third clears back
 * to the table's natural order. The third state matters: without it a table
 * can be sorted but never un-sorted, and the operator loses whatever
 * deliberate default ordering the page had.
 */
export function nextSort(current: SortState, key: string): SortState {
  if (current.key !== key) return { key, direction: "asc" };
  if (current.direction === "asc") return { key, direction: "desc" };
  return { key: null, direction: "asc" };
}

export interface PageState {
  page: number;
  perPage: number;
  totalPages: number;
  /** 1-based inclusive bounds of what is on screen, for "Showing 1-50 of 312". */
  from: number;
  to: number;
  /** 0-based offset, for slicing or a SQL OFFSET. */
  offset: number;
}

export const PER_PAGE_CHOICES = [25, 50, 100, 200] as const;
const DEFAULT_PER_PAGE = 50;

export function parsePaging(params: RawParams, total: number): PageState {
  const perRaw = Number(first(params.per));
  const perPage = (PER_PAGE_CHOICES as readonly number[]).includes(perRaw)
    ? perRaw
    : DEFAULT_PER_PAGE;

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const pageRaw = Number(first(params.page));
  /*
   * Clamped rather than trusted. Page 40 of a 3-page list happens constantly
   * in real use -- a bookmark, a Back press after a filter narrowed the
   * results -- and rendering an empty table with working pagination controls
   * looks exactly like "no results", which is a different and much more
   * alarming statement.
   */
  const page = Number.isFinite(pageRaw) ? Math.min(totalPages, Math.max(1, Math.trunc(pageRaw))) : 1;

  const offset = (page - 1) * perPage;
  return {
    page,
    perPage,
    totalPages,
    offset,
    from: total === 0 ? 0 : offset + 1,
    to: Math.min(total, offset + perPage),
  };
}

/**
 * Build the query string for a view.
 *
 * Empty values are omitted, never written as `key=`. A URL full of empty
 * parameters is unreadable, breaks equality checks between two "same" views,
 * and makes a cleared filter indistinguishable from one set to blank.
 */
export function buildQuery(input: {
  filters?: FilterValues;
  sort?: SortState;
  page?: number;
  perPage?: number;
}): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(input.filters ?? {})) {
    if (v != null && String(v).trim() !== "") params.set(k, String(v).trim());
  }
  const sort = input.sort ? serializeSort(input.sort) : "";
  if (sort) params.set("sort", sort);
  // Page 1 is the default, so saying so adds noise to every link.
  if (input.page && input.page > 1) params.set("page", String(input.page));
  if (input.perPage && input.perPage !== DEFAULT_PER_PAGE) {
    params.set("per", String(input.perPage));
  }
  return params.toString();
}

export function buildHref(pathname: string, input: Parameters<typeof buildQuery>[0]): string {
  const qs = buildQuery(input);
  return qs ? `${pathname}?${qs}` : pathname;
}

export interface FilterChip {
  key: string;
  label: string;
  /** What the filter is set to, in the words the operator chose it by. */
  display: string;
}

/**
 * The active filters, as things a person can read and remove one at a time.
 *
 * A filter you cannot see is a filter you cannot undo, and "why is this list
 * empty" is almost always a filter three fields to the right that nobody
 * remembers setting. Chips make the answer visible without reading the URL.
 */
export function activeChips(specs: FilterSpec[], values: FilterValues): FilterChip[] {
  const chips: FilterChip[] = [];
  for (const spec of specs) {
    const v = values[spec.key];
    if (!v) continue;
    let display = v;
    if (spec.kind === "boolean") display = "yes";
    if (spec.kind === "min") display = `${v}+`;
    if (spec.kind === "select") {
      display = spec.options?.find((o) => o.value === v)?.label ?? v;
    }
    chips.push({ key: spec.key, label: spec.label, display });
  }
  return chips;
}

/** Remove one filter, leaving the rest of the view alone. */
export function withoutFilter(values: FilterValues, key: string): FilterValues {
  const next = { ...values };
  delete next[key];
  return next;
}

export type Density = "comfortable" | "compact";

export interface SavedView {
  id: string;
  name: string;
  /** The query string, without a leading "?". */
  query: string;
}

/**
 * A saved view is a named query string and nothing more.
 *
 * Deliberately not a stored object with its own filter fields: the moment a
 * saved view has its own schema, it drifts from what the toolbar can express,
 * and restoring one produces a list the controls cannot describe. Storing the
 * URL means a view can only ever be something the page can already render.
 */
export function isSameView(a: string, b: string): boolean {
  const norm = (q: string) => {
    const p = new URLSearchParams(q);
    // Paging is a position in a view, not part of its identity: "Due this
    // week, page 3" is the same saved view as "Due this week".
    p.delete("page");
    const entries = [...p.entries()].sort(([x], [y]) => x.localeCompare(y));
    return entries.map(([k, v]) => `${k}=${v}`).join("&");
  };
  return norm(a) === norm(b);
}

/**
 * Sort an in-memory list the same way the URL says.
 *
 * For lists small and bounded enough that paging them in SQL is more machinery
 * than the problem deserves -- the platform's own account list, say. The URL
 * still decides, so these pages behave identically to the ones backed by a
 * query and an operator never has to learn two sets of rules.
 *
 * Callers supply ACCESSORS, not comparators, and that is deliberate. A
 * comparator has to encode both "which is bigger" and "where do blanks go",
 * and the direction flip then inverts both -- so a descending sort put every
 * empty cell at the top, which is the one place nobody wants them. Owning the
 * comparison here means a caller cannot get that wrong.
 *
 * A key with no accessor leaves the order alone: the natural order a page
 * chose is a better answer than an arbitrary one.
 */
export function sortRows<T>(
  rows: T[],
  sort: SortState,
  accessors: Record<string, (row: T) => unknown>
): T[] {
  if (!sort.key) return rows;
  const get = accessors[sort.key];
  if (!get) return rows;
  const sign = sort.direction === "desc" ? -1 : 1;
  // Copied, not sorted in place: the caller may still be holding the original
  // order, and an in-place sort of a shared array is the kind of bug that only
  // shows up on the second render.
  return [...rows].sort((a, b) => {
    const av = get(a);
    const bv = get(b);
    const aEmpty = av == null || av === "";
    const bEmpty = bv == null || bv === "";
    /*
     * Blanks last in BOTH directions. Sorting by "last contacted" should put
     * the extremes of what is known at the top; a null is the absence of an
     * answer, not an early or a late one.
     */
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;
    if (bEmpty) return -1;
    if (typeof av === "number" && typeof bv === "number") return sign * (av - bv);
    return sign * String(av).localeCompare(String(bv));
  });
}

/** The slice of an in-memory list that belongs on this page. */
export function pageRows<T>(rows: T[], paging: PageState): T[] {
  return rows.slice(paging.offset, paging.offset + paging.perPage);
}
