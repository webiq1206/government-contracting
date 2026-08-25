/**
 * The rules a filtered, sorted, paged list follows.
 *
 * These are worth pinning because every one of them has a failure mode that
 * looks like missing data rather than a bug: a filter the toolbar cannot show,
 * a page number past the end of the results, a select holding a value that is
 * no longer an option. In each case the operator sees an empty table and
 * concludes there is nothing there.
 */
import { describe, it, expect } from "vitest";
import {
  parseFilters,
  parseSort,
  serializeSort,
  nextSort,
  parsePaging,
  buildQuery,
  buildHref,
  activeChips,
  withoutFilter,
  isSameView,
  sortRows,
  pageRows,
  type FilterSpec,
} from "@/lib/domain/table-view";

const SPECS: FilterSpec[] = [
  { key: "q", label: "Search", kind: "text" },
  { key: "state", label: "State", kind: "text", upper: true },
  {
    key: "health",
    label: "Email health",
    kind: "select",
    options: [
      { value: "verified", label: "Verified" },
      { value: "bounced", label: "Bounced" },
    ],
  },
  { key: "preferred", label: "Preferred", kind: "boolean" },
  { key: "minRel", label: "Reliability", kind: "min", min: 0, max: 100 },
];

describe("parseFilters", () => {
  it("keeps what the specs allow and normalizes it", () => {
    const v = parseFilters(SPECS, { q: "  rivera ", state: "tx", preferred: "1", minRel: "70" });
    expect(v).toEqual({ q: "rivera", state: "TX", preferred: "1", minRel: "70" });
  });

  it("drops a filter the page cannot show", () => {
    /*
     * A filter the toolbar has no control for cannot be seen or removed, so
     * honouring it produces a narrowed list that the visible controls do not
     * explain. Better to ignore it and show everything.
     */
    expect(parseFilters(SPECS, { colour: "blue" })).toEqual({});
  });

  it("drops a select value that is not an option", () => {
    // A stale link or a typo, not an instruction. Showing the full list is
    // recoverable; showing an empty one reads as "you have no subcontractors".
    expect(parseFilters(SPECS, { health: "smells-funny" })).toEqual({});
    expect(parseFilters(SPECS, { health: "bounced" })).toEqual({ health: "bounced" });
  });

  it("treats blank as absent rather than as a value", () => {
    expect(parseFilters(SPECS, { q: "", state: "   " })).toEqual({});
  });

  it("only turns a boolean on for an explicit 1", () => {
    expect(parseFilters(SPECS, { preferred: "0" })).toEqual({});
    expect(parseFilters(SPECS, { preferred: "false" })).toEqual({});
    expect(parseFilters(SPECS, { preferred: "1" })).toEqual({ preferred: "1" });
  });

  it("clamps a number into its declared range instead of refusing it", () => {
    expect(parseFilters(SPECS, { minRel: "9000" }).minRel).toBe("100");
    expect(parseFilters(SPECS, { minRel: "-5" }).minRel).toBe("0");
    expect(parseFilters(SPECS, { minRel: "abc" }).minRel).toBeUndefined();
  });

  it("takes the first value when a key is repeated", () => {
    expect(parseFilters(SPECS, { q: ["one", "two"] })).toEqual({ q: "one" });
  });
});

describe("sorting", () => {
  it("reads the leading-minus convention", () => {
    expect(parseSort({ sort: "name" }, ["name"])).toEqual({ key: "name", direction: "asc" });
    expect(parseSort({ sort: "-name" }, ["name"])).toEqual({ key: "name", direction: "desc" });
  });

  it("ignores a column the table does not have", () => {
    expect(parseSort({ sort: "-salary" }, ["name"])).toEqual({ key: null, direction: "asc" });
  });

  it("cycles ascending, descending, then off", () => {
    /*
     * The third state is the one people forget. Without it a table can be
     * sorted but never un-sorted, and whatever deliberate default order the
     * page had is gone until a full reload.
     */
    let s = parseSort({}, ["name"]);
    s = nextSort(s, "name");
    expect(s).toEqual({ key: "name", direction: "asc" });
    s = nextSort(s, "name");
    expect(s).toEqual({ key: "name", direction: "desc" });
    s = nextSort(s, "name");
    expect(s).toEqual({ key: null, direction: "asc" });
  });

  it("starts a different column fresh, ascending", () => {
    const s = nextSort({ key: "name", direction: "desc" }, "rating");
    expect(s).toEqual({ key: "rating", direction: "asc" });
  });

  it("round-trips through the query string", () => {
    const s = { key: "rating", direction: "desc" as const };
    expect(parseSort({ sort: serializeSort(s) }, ["rating"])).toEqual(s);
  });
});

describe("parsePaging", () => {
  it("describes the window in the words the footer uses", () => {
    const p = parsePaging({ page: "2", per: "50" }, 312);
    expect(p).toMatchObject({ page: 2, perPage: 50, totalPages: 7, from: 51, to: 100, offset: 50 });
  });

  it("clamps a page past the end instead of rendering nothing", () => {
    /*
     * Bookmarks and the Back button produce this constantly: page 40 of a
     * list a filter has since narrowed to 3 pages. An empty table with
     * working pagination controls looks exactly like "no results", which is a
     * different and much more alarming statement.
     */
    expect(parsePaging({ page: "40" }, 30).page).toBe(1);
    expect(parsePaging({ page: "0" }, 300).page).toBe(1);
    expect(parsePaging({ page: "-3" }, 300).page).toBe(1);
  });

  it("refuses a per-page size it does not offer", () => {
    expect(parsePaging({ per: "10000" }, 300).perPage).toBe(50);
  });

  it("reports an empty list as 0 of 0, not 1 of 0", () => {
    const p = parsePaging({}, 0);
    expect(p).toMatchObject({ from: 0, to: 0, totalPages: 1 });
  });
});

describe("buildQuery", () => {
  it("omits empty values rather than writing key=", () => {
    expect(buildQuery({ filters: { q: "rivera", state: "" } })).toBe("q=rivera");
  });

  it("omits the defaults, so a plain view is a plain link", () => {
    expect(buildQuery({ page: 1, perPage: 50 })).toBe("");
    expect(buildHref("/subs", {})).toBe("/subs");
  });

  it("keeps a non-default page and size", () => {
    expect(buildQuery({ page: 3, perPage: 100 })).toBe("page=3&per=100");
  });

  it("writes the sort in the form it reads back", () => {
    expect(buildQuery({ sort: { key: "rating", direction: "desc" } })).toBe("sort=-rating");
  });
});

describe("activeChips", () => {
  it("says what each filter is set to, in the operator's own words", () => {
    const values = parseFilters(SPECS, {
      state: "tx",
      health: "bounced",
      preferred: "1",
      minRel: "70",
    });
    expect(activeChips(SPECS, values)).toEqual([
      { key: "state", label: "State", display: "TX" },
      // The label, not the stored value: they picked "Bounced", not "bounced".
      { key: "health", label: "Email health", display: "Bounced" },
      { key: "preferred", label: "Preferred", display: "yes" },
      { key: "minRel", label: "Reliability", display: "70+" },
    ]);
  });

  it("shows nothing when nothing is filtered", () => {
    expect(activeChips(SPECS, {})).toEqual([]);
  });

  it("removes one filter without disturbing the others", () => {
    const values = { q: "rivera", state: "TX" };
    expect(withoutFilter(values, "state")).toEqual({ q: "rivera" });
    // The original is untouched: callers hold on to it for the current render.
    expect(values).toEqual({ q: "rivera", state: "TX" });
  });
});

describe("isSameView", () => {
  it("ignores parameter order", () => {
    expect(isSameView("state=TX&q=a", "q=a&state=TX")).toBe(true);
  });

  it("ignores which page you are on", () => {
    // "Due this week, page 3" is the same saved view as "Due this week".
    expect(isSameView("q=a&page=3", "q=a")).toBe(true);
  });

  it("does not confuse two different filters", () => {
    expect(isSameView("state=TX", "state=NM")).toBe(false);
    expect(isSameView("state=TX", "state=TX&preferred=1")).toBe(false);
  });
});

describe("in-memory views", () => {
  const rows = [
    { id: "a", name: "Delta", score: 10 as number | null, seen: "2026-01-02" as string | null },
    { id: "b", name: "Alpha", score: null as number | null, seen: null as string | null },
    { id: "c", name: "Charlie", score: 30 as number | null, seen: "2026-03-04" as string | null },
  ];
  const at = {
    name: (r: (typeof rows)[0]) => r.name,
    score: (r: (typeof rows)[0]) => r.score,
    seen: (r: (typeof rows)[0]) => r.seen,
  };

  it("sorts by the column the URL names", () => {
    expect(sortRows(rows, { key: "name", direction: "asc" }, at).map((r) => r.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(sortRows(rows, { key: "score", direction: "desc" }, at).map((r) => r.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("keeps blanks last whichever way it is sorted", () => {
    /*
     * The bug this pins: sign-flipping a comparator that also encoded "blanks
     * last" inverted the null handling too, so a descending sort opened with a
     * screen of empty cells. Sorting by "last contacted" should show the
     * extremes of what IS known.
     */
    expect(sortRows(rows, { key: "seen", direction: "asc" }, at).at(-1)!.id).toBe("b");
    expect(sortRows(rows, { key: "seen", direction: "desc" }, at).at(-1)!.id).toBe("b");
    expect(sortRows(rows, { key: "score", direction: "asc" }, at).at(-1)!.id).toBe("b");
  });

  it("leaves the natural order alone when nothing is sorted", () => {
    expect(sortRows(rows, { key: null, direction: "asc" }, at)).toBe(rows);
  });

  it("leaves the natural order alone for a column with no accessor", () => {
    // A page's deliberate default ordering beats an arbitrary one.
    expect(sortRows(rows, { key: "mystery", direction: "asc" }, at)).toBe(rows);
  });

  it("does not reorder the array it was given", () => {
    const before = rows.map((r) => r.id);
    sortRows(rows, { key: "name", direction: "asc" }, at);
    expect(rows.map((r) => r.id)).toEqual(before);
  });

  it("takes the slice the page state describes", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ id: String(i) }));
    const p = parsePaging({ page: "2", per: "25" }, 10);
    expect(pageRows(many, { ...p, perPage: 4, offset: 4 }).map((r) => r.id)).toEqual([
      "4",
      "5",
      "6",
      "7",
    ]);
  });
});
