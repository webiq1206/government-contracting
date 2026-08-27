import { describe, expect, it } from "vitest";
import {
  dedupeRequirements,
  extractClauses,
  extractPageLimits,
  findDuplicateRequirements,
  pageLimitContradictions,
  pageOf,
} from "../lib/domain/extraction-checks";

/**
 * A model asked for a deadline returns a deadline. Nothing in valid JSON says
 * whether any of it is in the file.
 *
 * Some things in a solicitation have a shape that can be read exactly. Where a
 * deterministic reading and the model disagree, the disagreement is the
 * finding, surfaced rather than resolved: overwriting the model with a regex
 * trades one unverified answer for another.
 */

describe("clause identifiers", () => {
  it("reads FAR and DFARS numbers and tells them apart", () => {
    const clauses = extractClauses(
      "Incorporated: 52.212-4, 52.204-7 and DFARS 252.204-7012 apply to this order."
    );
    expect(clauses.map((c) => c.id)).toEqual(["52.212-4", "52.204-7", "252.204-7012"]);
    expect(clauses.map((c) => c.regulation)).toEqual(["FAR", "FAR", "DFARS"]);
  });

  it("keeps an alternate as its own clause", () => {
    // 52.212-4 Alt I is a different clause with different obligations.
    // Normalizing it away would silently drop the version that applies.
    const clauses = extractClauses("52.212-4 Alt I and 52.212-4 both appear.");
    expect(clauses.map((c) => c.id)).toEqual(["52.212-4 Alt I", "52.212-4"]);
  });

  it("lists each clause once however often it is mentioned", () => {
    expect(extractClauses("52.212-4 ... 52.212-4 ... 52.212-4")).toHaveLength(1);
  });

  it("cites the page when the text carries markers", () => {
    const text = "[p.1]\nnothing here\n\n[p.14]\nClause 52.222-6 applies.";
    expect(extractClauses(text)[0].page).toBe(14);
  });

  it("says the page is unknown rather than guessing page one", () => {
    // A document with no page structure has no page to cite, and returning 1
    // would be a guess dressed as a fact.
    expect(extractClauses("Clause 52.222-6 applies.")[0].page).toBeNull();
    expect(pageOf("no markers here", 5)).toBeNull();
  });

  it("does not mistake a version number for a clause", () => {
    // The pattern is anchored to the two prefixes that exist, 52 and 252, so
    // "Version 12.212-4" is not a clause and neither is "52.2".
    expect(extractClauses("Version 12.212-4 of spec 52.2")).toEqual([]);
  });

  it("finds nothing in text that mentions no clauses", () => {
    expect(extractClauses("Provide weekly water treatment service visits.")).toEqual([]);
  });

});

describe("page limits", () => {
  it.each([
    ["The technical volume shall not exceed 20 pages.", 20],
    ["Proposals are limited to ten (10) pages.", 10],
    ["A maximum of 5 pages is permitted.", 5],
    ["No more than 30 single-sided pages.", 30],
  ])("reads %s", (text, pages) => {
    expect(extractPageLimits(text)[0]?.pages).toBe(pages);
  });

  it("attaches the limit to the volume it applies to", () => {
    const limits = extractPageLimits(
      "Volume II Technical Approach shall not exceed 20 pages. Past Performance is limited to 5 pages."
    );
    expect(limits[0].applesTo).toMatch(/Technical|Volume II/);
    expect(limits[1].applesTo).toMatch(/Past Performance/);
  });

  it("ignores a number that is not a page count", () => {
    // A pattern loose enough to catch every phrasing is loose enough to catch
    // nonsense. Anything outside a plausible range is dropped rather than
    // reported as a limit somebody has to reconcile.
    expect(extractPageLimits("limited to 0 pages")).toEqual([]);
    expect(extractPageLimits("no more than 9000 pages")).toEqual([]);
  });
});

describe("contradictions", () => {
  it("reports two page limits for the same thing without deciding", () => {
    /*
     * Common and consequential: the base solicitation says twenty, an
     * amendment says ten, and the amendment is the one that counts. Which is
     * right depends on which document is current, which is a judgement about
     * the solicitation rather than about text, so this names the
     * disagreement and stops.
     */
    const found = pageLimitContradictions([
      { applesTo: "Technical Volume", pages: 20, page: 3 },
      { applesTo: "Technical Volume", pages: 10, page: 1 },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].detail).toContain("10 and 20");
    expect(found[0].detail).toContain("Confirm which applies");
  });

  it("says nothing when the same limit is stated twice", () => {
    expect(
      pageLimitContradictions([
        { applesTo: null, pages: 20, page: 1 },
        { applesTo: null, pages: 20, page: 9 },
      ])
    ).toEqual([]);
  });

  it("does not confuse limits on different volumes", () => {
    expect(
      pageLimitContradictions([
        { applesTo: "Technical Volume", pages: 20, page: 1 },
        { applesTo: "Past Performance", pages: 5, page: 1 },
      ])
    ).toEqual([]);
  });
});

describe("the same requirement listed twice", () => {
  const r = (id: string, title: string, over: Record<string, unknown> = {}) => ({
    id,
    title,
    ...over,
  });

  it("merges two wordings of one form", () => {
    // Two rows makes an operator do one job twice and makes the package
    // validator demand two files where one exists.
    const groups = findDuplicateRequirements([
      r("a", "Signed SF-1449", { officialForm: "SF-1449" }),
      r("b", "SF-1449 offer form", { officialForm: "sf-1449" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].keep.id).toBe("a");
    expect(groups[0].drop.map((d) => d.id)).toEqual(["b"]);
  });

  it("merges on wording when there is no form to go on", () => {
    const groups = findDuplicateRequirements([
      r("a", "Signed capability statement"),
      r("b", "Capability statement, completed"),
    ]);
    expect(groups).toHaveLength(1);
  });

  it("refuses to merge things that merely look alike", () => {
    /*
     * "Bid bond" and "Payment bond" are different documents with different
     * costs. A merge that guesses is worse than a list that repeats itself,
     * because the repetition is visible and the merge is not.
     */
    expect(
      findDuplicateRequirements([r("a", "Bid bond"), r("b", "Payment bond"), r("c", "Performance bond")])
    ).toEqual([]);
  });

  it("keeps mandatory when the duplicate disagrees", () => {
    /*
     * The one asymmetric merge rule. If the same requirement appears once as
     * required and once as optional, dropping the required one turns a
     * disqualifier into a suggestion.
     */
    const out = dedupeRequirements([
      r("a", "SF-1449", { officialForm: "SF-1449", mandatory: false }),
      r("b", "Signed SF-1449", { officialForm: "SF-1449", mandatory: true }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("a");
    expect(out[0].mandatory).toBe(true);
  });

  it("leaves a list with no duplicates exactly as it was", () => {
    const input = [r("a", "Bid bond"), r("b", "Pricing schedule"), r("c", "Reps and certs")];
    expect(dedupeRequirements(input)).toEqual(input);
  });

  it("ignores a requirement whose title reduces to nothing", () => {
    // "The" and "a" reduce to an empty key, and grouping on empty would merge
    // every such row into one.
    expect(findDuplicateRequirements([r("a", "the"), r("b", "a")])).toEqual([]);
  });
});
