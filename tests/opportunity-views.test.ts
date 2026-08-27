import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The three views the brief names, and the nine facts a row has to carry.
 *
 * Two of the three existed. The compact list did not, and on a phone the
 * default view was a swipe rail of four columns: a pattern that asks somebody
 * to discover three more horizontal panes before they can see their own work,
 * which is the information being present without being reachable.
 *
 * Of the nine required facts, four were on the card and five were not, and the
 * five missing ones are the ones that say whether the number beside them can
 * be trusted.
 */

const PAGE = readFileSync("app/(dash)/pipeline/page.tsx", "utf8");
const LIST = readFileSync("components/opportunity-list.tsx", "utf8");
const FACTS = readFileSync("components/opportunity-facts.tsx", "utf8");
const DATA = readFileSync("lib/data.ts", "utf8");

describe("the views", () => {
  it("offers table, board, and a compact list", () => {
    for (const v of ["view=table", "view=stages", "view=list"]) {
      expect(PAGE).toContain(v);
    }
  });

  it("makes the compact list what a phone gets by default", () => {
    /*
     * The server cannot know the viewport, so the default renders as the list
     * below the board's breakpoint and as lanes above it. An explicit choice
     * is honoured at every width.
     */
    expect(PAGE).toContain('view === "list" || view === "lanes"');
    expect(PAGE).toContain("overflow-y-auto p-4 md:hidden");
  });

  it("does not leave a hidden rail behind", () => {
    // A block that can never render is markup a later reader has to work out
    // the purpose of, and it was the phone's whole view a moment ago.
    expect(PAGE).not.toContain('<div className="hidden min-h-0 flex-1 flex-col">');
  });
});

describe("the nine facts on a row", () => {
  it("carries all of them", () => {
    for (const fact of [
      "nextAction?.[o.stage]",
      "DeadlineBadge",
      "ScoreBadge",
      "ConfidenceChip",
      "CoverageChip",
      "OwnerChip",
      "BlockerChip",
      "EstimatedValue",
      "AgencyPath",
    ]) {
      expect(LIST, `missing ${fact}`).toContain(fact);
    }
  });

  it("does not call an unmeasured confidence low", () => {
    /*
     * Low is a measurement. A record scored before confidence existed has its
     * absence, and wearing the worst badge available would be the interface
     * asserting something nobody measured.
     */
    expect(FACTS).toContain("Confidence not measured");
  });

  it("does not call an unread solicitation fully covered", () => {
    // "0 of 0" is not full coverage, it is an analysis that has not run, and
    // the two must not render the same way.
    expect(FACTS).toContain("Trades not read yet");
  });

  it("names the blocker rather than counting blockers", () => {
    // "1 blocker" tells somebody to open the record to find out what it is,
    // which is the click the chip exists to save.
    expect(FACTS).toContain("flagSummary(flags)");
  });
});

describe("what covered means", () => {
  it("is defined once, for the filter and the count alike", () => {
    /*
     * Written twice they would drift, and the drift would be silent: a filter
     * saying a bid is covered beside a card saying two trades are missing.
     */
    expect(DATA).toContain("const TRADE_COVERED_SQL");
    expect(DATA).toContain("const REQUIRED_TRADES_SQL");
    const uses = DATA.split("TRADE_COVERED_SQL").length - 1;
    // The definition, the coverage query, and the filter.
    expect(uses).toBeGreaterThanOrEqual(3);
  });
});
