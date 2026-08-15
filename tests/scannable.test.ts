import { describe, it, expect } from "vitest";
import { toScannable, firstLine } from "@/lib/domain/scannable";

const long = (s: string) => s.padEnd(200, " filler words to pass the length gate.");

describe("toScannable", () => {
  it("leaves short text as prose: it is already scannable", () => {
    const r = toScannable("Replace two rooftop units.");
    expect(r).toEqual({ kind: "prose", text: "Replace two rooftop units." });
  });

  it("returns nothing for empty or whitespace-only text", () => {
    expect(toScannable("")).toBeNull();
    expect(toScannable("   \n ")).toBeNull();
    expect(toScannable(null)).toBeNull();
    expect(toScannable(undefined)).toBeNull();
  });

  it("recovers a semicolon list the analyst wrote as one paragraph", () => {
    const text =
      "Demolish the existing ductwork and haul it off site; install new spiral duct " +
      "throughout the second floor; balance the system and provide test reports; " +
      "coordinate ceiling access with the general contractor before starting";
    const r = toScannable(text);
    expect(r?.kind).toBe("bullets");
    if (r?.kind !== "bullets") throw new Error("expected bullets");
    expect(r.items).toHaveLength(4);
    expect(r.items[0]).toMatch(/^Demolish/);
    expect(r.items[3]).toMatch(/^coordinate/);
  });

  it("recovers hard line breaks and strips the bullet glyphs already there", () => {
    const text =
      "• Replace all rooftop condensing units on building four\n" +
      "• Provide a full year of maintenance after acceptance\n" +
      "• Remove and dispose of refrigerant per EPA requirements";
    const r = toScannable(text);
    expect(r?.kind).toBe("bullets");
    if (r?.kind !== "bullets") throw new Error("expected bullets");
    expect(r.items).toHaveLength(3);
    expect(r.items.every((i) => !i.startsWith("•"))).toBe(true);
  });

  it("recovers a numbered list and drops the numbering", () => {
    const text =
      "1. Furnish and install the new air handling unit on the roof curb " +
      "2. Connect to existing controls and verify sequence of operations " +
      "3. Provide as-built drawings and O and M manuals at closeout";
    const r = toScannable(text);
    expect(r?.kind).toBe("bullets");
    if (r?.kind !== "bullets") throw new Error("expected bullets");
    expect(r.items).toHaveLength(3);
    expect(r.items[0]).toMatch(/^Furnish/);
  });

  it("does not chop a genuine paragraph into fragments", () => {
    // No list structure: one long thought. Splitting it would read worse than
    // leaving it, which is the whole point of being conservative here.
    const text = long(
      "The contractor shall furnish all labor and materials required to complete " +
        "the work described in the drawings and specifications in a workmanlike manner."
    );
    expect(toScannable(text)?.kind).toBe("prose");
  });

  it("does not bullet a paragraph that merely contains one semicolon", () => {
    const text =
      "The work consists of a complete replacement of the existing chilled water " +
      "system including all piping, valves, insulation, controls, and commissioning; " +
      "minor patching is incidental.";
    // The first clause is nearly the whole text, so this is a paragraph.
    expect(toScannable(text)?.kind).toBe("prose");
  });

  it("never drops or reorders content when it does bullet", () => {
    const text =
      "Install forty new light fixtures across the east wing corridors; " +
      "recycle every removed fixture and ballast per state rules; " +
      "provide a two year warranty on parts and labor for the work";
    const r = toScannable(text);
    if (r?.kind !== "bullets") throw new Error("expected bullets");
    const rejoined = r.items.join(" ").toLowerCase();
    for (const word of ["forty", "recycle", "warranty", "corridors"]) {
      expect(rejoined).toContain(word);
    }
  });
});

describe("firstLine", () => {
  it("takes the first sentence when there is one", () => {
    expect(firstLine("Replace two units. Then balance the system.")).toBe(
      "Replace two units."
    );
  });

  it("cuts on a word boundary and marks the cut", () => {
    const r = firstLine("a".repeat(10) + " " + "b".repeat(200), 40);
    expect(r.endsWith("…")).toBe(true);
    expect(r.length).toBeLessThanOrEqual(41);
  });

  it("does not add an ellipsis when nothing was cut", () => {
    expect(firstLine("Short enough.")).toBe("Short enough.");
    expect(firstLine("Short enough.").endsWith("…")).toBe(false);
  });

  it("is empty for empty input", () => {
    expect(firstLine("")).toBe("");
    expect(firstLine(null)).toBe("");
  });
});
