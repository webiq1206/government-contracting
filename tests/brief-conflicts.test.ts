import { describe, expect, it } from "vitest";
import { conflictingFacts } from "../lib/domain/brief-conflicts";
import { setAsideCategory } from "../lib/domain/eligibility";

/**
 * Where the notice and the document do not agree.
 *
 * The decision brief listed what is known and what is missing, and had nowhere
 * for the third thing: two sources stating different facts. That third thing
 * is the one most likely to lose a bid. The portal record says Total Small
 * Business, the solicitation says SDVOSB, and a company reading only one of
 * them submits a proposal it can be disqualified on.
 *
 * The eligibility gate could not catch it either: it concatenates both fields
 * into one string, so a disagreement reads as though both applied.
 */

const NONE = {
  setAsideFromNotice: null,
  setAsideFromDocument: null,
  valueFromNotice: null,
  valueTextFromDocument: null,
};

describe("classifying a set-aside", () => {
  it("reads the socioeconomic categories", () => {
    expect(setAsideCategory("Service-Disabled Veteran-Owned Small Business")).toBe("sdvosb");
    expect(setAsideCategory("SDVOSB Set-Aside")).toBe("sdvosb");
    expect(setAsideCategory("8(a) Sole Source")).toBe("8a");
    expect(setAsideCategory("HUBZone Set-Aside")).toBe("hubzone");
    expect(setAsideCategory("Total Small Business Set-Aside")).toBe("small_business");
  });

  it("does not read a veteran category out of a service-disabled one", () => {
    // The narrower term contains the broader one's words. Reporting both would
    // make one set-aside look like two.
    expect(setAsideCategory("Service-Disabled Veteran-Owned")).toBe("sdvosb");
  });

  it("tells silence from a statement", () => {
    // "Unrestricted" is a statement that anybody may bid. Null is nobody
    // having said, and the two must not compare equal.
    expect(setAsideCategory(null)).toBeNull();
    expect(setAsideCategory("")).toBeNull();
    expect(setAsideCategory("Unrestricted")).toBe("unrestricted");
  });
});

describe("conflicts", () => {
  it("reports a set-aside the two sources disagree on", () => {
    const c = conflictingFacts({
      ...NONE,
      setAsideFromNotice: "Total Small Business Set-Aside",
      setAsideFromDocument: "SDVOSB Set-Aside",
    });
    expect(c).toHaveLength(1);
    expect(c[0]!.field).toBe("Set-aside");
    expect(c[0]!.fromNotice).toContain("Total Small Business");
    expect(c[0]!.fromDocument).toContain("SDVOSB");
  });

  it("says nothing when they agree in different words", () => {
    expect(
      conflictingFacts({
        ...NONE,
        setAsideFromNotice: "SDVOSB",
        setAsideFromDocument: "Service-Disabled Veteran-Owned Small Business set-aside",
      })
    ).toEqual([]);
  });

  it("treats silence as absence, not as disagreement", () => {
    /*
     * A field the notice states and the document does not is a fact, not a
     * conflict, and belongs in the missing list. Reporting it here would fill
     * this section on every thin notice and teach the operator to skip it.
     */
    expect(
      conflictingFacts({ ...NONE, setAsideFromNotice: "SDVOSB Set-Aside" })
    ).toEqual([]);
    expect(
      conflictingFacts({ ...NONE, valueFromNotice: 500_000 })
    ).toEqual([]);
  });

  it("reports a misplaced zero and ignores a rounding", () => {
    // "Approximately $1.2M" against a portal $1,150,000 is one fact told
    // twice. $120,000 against $1,200,000 is a zero somebody has to catch
    // before pricing a bid against the wrong one.
    expect(
      conflictingFacts({
        ...NONE,
        valueFromNotice: 1_150_000,
        valueTextFromDocument: "approximately $1,200,000",
      })
    ).toEqual([]);
    const c = conflictingFacts({
      ...NONE,
      valueFromNotice: 120_000,
      valueTextFromDocument: "estimated at $1,200,000",
    });
    expect(c).toHaveLength(1);
    expect(c[0]!.field).toBe("Contract value");
    expect(c[0]!.fromNotice).toBe("$120,000");
    expect(c[0]!.fromDocument).toBe("$1,200,000");
  });

  it("reports rather than resolves", () => {
    /*
     * Nothing here picks a winner. The analyst's value backfill deliberately
     * only fills a null, so both figures survive in the record, and this is
     * where a person is told to go and look.
     */
    const c = conflictingFacts({
      ...NONE,
      setAsideFromNotice: "8(a)",
      setAsideFromDocument: "HUBZone Set-Aside",
      valueFromNotice: 100_000,
      valueTextFromDocument: "$5,000,000",
    });
    expect(c.map((x) => x.field)).toEqual(["Set-aside", "Contract value"]);
    for (const x of c) expect(x.matters.length).toBeGreaterThan(20);
  });
});
