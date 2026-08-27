import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { activeChips, clearedFilters, type FilterSpec } from "../lib/domain/table-view";

/**
 * The filters on a phone.
 *
 * Inline they do not fit. Opportunities declares thirteen of them, and a
 * sticky bar holding thirteen labelled fields on a 390px screen is taller than
 * the screen: the list they filter is somewhere below the fold, so the
 * operator scrolls past the controls to see the effect and back up to change
 * it.
 *
 * The sheet is also the one place in this bar that keeps an Apply button, and
 * that is not an inconsistency. The inline bar applies on change because its
 * controls stay put; the sheet IS the thing being edited, so navigating on the
 * first field would tear it down with the other twelve still unset.
 */

const SPECS: FilterSpec[] = [
  { key: "agency", label: "Agency", kind: "text" },
  { key: "stage", label: "Stage", kind: "select", options: [{ value: "bid", label: "Bidding" }] },
];

const SOURCE = readFileSync("components/filter-toolbar.tsx", "utf8");

describe("clearing the filters", () => {
  it("leaves alone the part of the URL the bar does not own", () => {
    /*
     * The bug this replaces: Clear all handed back `{}`, which is only correct
     * on a page whose whole query string is filters. Opportunities carries
     * `view=table` beside them, so clearing the filters dropped the operator
     * back onto the lanes board. They asked for fewer rows and got a different
     * page.
     */
    const cleared = clearedFilters(SPECS, { agency: "GSA", stage: "bid", view: "table" });
    expect(cleared).toEqual({ view: "table" });
  });

  it("removes every filter it does own", () => {
    expect(activeChips(SPECS, clearedFilters(SPECS, { agency: "GSA", stage: "bid" }))).toEqual([]);
  });

  it("is a no-op when nothing is filtered", () => {
    expect(clearedFilters(SPECS, { view: "table" })).toEqual({ view: "table" });
  });

  it("is what the bar actually calls", () => {
    // The function being right is worth nothing if Clear all still hands back
    // an empty object, and that is exactly the half of this fix a later diff
    // would undo without noticing.
    expect(SOURCE).toContain("go(clearedFilters(specs, values))");
    expect(SOURCE).not.toContain("go({})");
  });
});

describe("the sheet", () => {
  it("has the four things the brief names", () => {
    // Result count, active chips, Clear, Apply. Each is one line and each is
    // the line somebody drops when the sheet is "basically done".
    expect(SOURCE).toContain("resultLabel ?? ");
    expect(SOURCE).toContain("pendingChips.map");
    expect(SOURCE).toMatch(/>\s*Clear\s*</);
    expect(SOURCE).toMatch(/>\s*Apply\s*</);
  });

  it("never shows a count for filters that are not applied yet", () => {
    /*
     * The worst version of this control is one that guesses. An operator
     * narrows to one agency, reads "312", and applies a filter they would not
     * have chosen, because 312 was the count for the query underneath.
     */
    expect(SOURCE).toContain("Apply to count these filters.");
  });

  it("traps focus, restores it, and closes on Escape", () => {
    const sheet = SOURCE.slice(SOURCE.indexOf("function FilterSheet"));
    expect(sheet).toContain('aria-modal="true"');
    expect(sheet).toContain('role="dialog"');
    expect(sheet).toContain('e.key === "Escape"');
    expect(sheet).toContain("const opener = returnFocusTo.current;");
    expect(sheet).toContain("opener?.focus?.()");
  });

  it("holds the list behind it still while it is open", () => {
    // Without the lock the list scrolls under the finger, so closing the sheet
    // returns the operator to a different part of the list than the one they
    // were reading.
    expect(SOURCE).toContain('document.body.style.overflow = "hidden"');
  });

  it("escapes the toolbar rather than being clipped by it", () => {
    /*
     * The bar has `backdrop-blur`. A backdrop-filter makes its element the
     * containing block for any fixed descendant, so a full-screen sheet
     * rendered inside it would be full-screen within a 90px strip. This is the
     * kind of thing that looks like a styling preference in a diff and is not.
     */
    expect(SOURCE).toContain("createPortal(");
    expect(SOURCE).toContain("document.body");
  });

  it("covers the bottom tab bar rather than sitting under it", () => {
    // The bar is z-[60]. A sheet below that has its Apply button hidden behind
    // five tabs, which is the "sticky bottom actions cannot overlap the global
    // tab bar" rule failing in the direction nobody checks.
    const z = SOURCE.match(/fixed inset-0 z-\[(\d+)\]/);
    expect(z, "the sheet should declare its own stacking level").not.toBeNull();
    expect(Number(z![1])).toBeGreaterThan(60);
  });

  it("keeps the inline controls off the phone entirely", () => {
    // Both would mean two sets of controls for one list, disagreeing whenever
    // one was edited.
    expect(SOURCE).toContain("hidden flex-wrap items-end gap-3 md:flex");
  });
});

describe("the button that opens it", () => {
  it("says how many filters are on without opening anything", () => {
    // A filtered list that looks unfiltered is the "why is this empty" trap,
    // and on a phone the chips below the bar can be scrolled past.
    expect(SOURCE).toContain("chips.length > 0 && (");
    expect(SOURCE).toContain('aria-haspopup="dialog"');
  });
});
