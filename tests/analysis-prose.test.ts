import { describe, it, expect } from "vitest";
import { tightenProse, tightenAnalysisProse } from "@/lib/domain/analysis-prose";

/**
 * Every word that went in must come out. The one rule this module has.
 *
 * List markers are excluded on both sides: a bullet glyph and the "1." of a
 * numbered item are markup that a line break replaces, not content.
 */
function wordsOf(s: string): string[] {
  return (
    s
      .replace(/(^|\s)\d+[.)](\s)/g, "$1$2")
      .toLowerCase()
      .match(/[a-z0-9]+/g) ?? []
  );
}

describe("tightenProse", () => {
  it("leaves a genuine paragraph alone", () => {
    const text =
      "The contractor shall provide all labor and materials to complete the work " +
      "in accordance with the drawings.";
    expect(tightenProse(text)).toBe(text);
  });

  it("is empty for empty input", () => {
    expect(tightenProse("")).toBe("");
    expect(tightenProse(null)).toBe("");
    expect(tightenProse(undefined)).toBe("");
  });

  it("puts an inline dash list onto separate lines", () => {
    const text =
      "Demolish the existing ductwork - Install new spiral duct on level two - " +
      "Balance the system and submit test reports";
    const out = tightenProse(text);
    expect(out.split("\n")).toHaveLength(3);
    expect(out.split("\n")[1]).toBe("Install new spiral duct on level two");
  });

  it("puts an inline bullet-glyph list onto separate lines and drops the glyphs", () => {
    const text = "Replace 14 rooftop units • Recycle the old refrigerant • Provide as-builts";
    const out = tightenProse(text);
    expect(out.split("\n")).toHaveLength(3);
    expect(out).not.toContain("•");
  });

  it("splits an inline numbered list and drops the numbering", () => {
    const text =
      "Furnish the new air handler on the existing curb 2. Connect it to the controls " +
      "3. Provide closeout documents at completion";
    const out = tightenProse(text);
    expect(out.split("\n").length).toBeGreaterThanOrEqual(2);
    expect(out.split("\n").some((l) => /^\d+[.)]/.test(l))).toBe(false);
  });

  it("does not split a hyphenated aside that is not a list", () => {
    const text = "Replace the rooftop units - all fourteen of them - before the heating season.";
    // Only one marker follows a capital, so this stays one line.
    expect(tightenProse(text).split("\n")).toHaveLength(1);
  });

  it("tidies markers and blank lines on text that is already a list", () => {
    const text = "• Demolish the ductwork\n\n\n- Install the new duct\n• Balance the system";
    const out = tightenProse(text);
    expect(out.split("\n").filter((l) => l.trim())).toHaveLength(3);
    expect(out).not.toContain("•");
    expect(out).not.toMatch(/\n{3}/);
  });

  it("never loses a word, whatever it does", () => {
    const inputs = [
      "Demolish the ductwork - Install new duct - Balance the system",
      "• One item here • Another item there",
      "A plain paragraph with no structure at all in it whatsoever.",
      "1. First thing to do 2. Second thing to do",
    ];
    for (const text of inputs) {
      const before = wordsOf(text);
      const after = wordsOf(tightenProse(text));
      expect(after).toEqual(before);
    }
  });
});

describe("tightenAnalysisProse", () => {
  it("tightens every long-form field and leaves the rest untouched", () => {
    const analysis = {
      project_overview: "Chiller replacement - Building four - Phased over two summers",
      scope_plain_language: "Remove the old chiller • Install the new one • Commission it",
      draft_sow: "A single sentence of scope.",
      trade_scopes: [
        { trade: "HVAC", work: "Pull the old unit - Set the new one - Tie into controls" },
      ],
      required_trades: ["HVAC"],
      estimated_value: "$400,000",
    };

    const out = tightenAnalysisProse(analysis);

    expect(out.project_overview.split("\n")).toHaveLength(3);
    expect(out.scope_plain_language.split("\n")).toHaveLength(3);
    expect(out.draft_sow).toBe("A single sentence of scope.");
    expect(out.trade_scopes[0].work.split("\n")).toHaveLength(3);
    // Untouched fields survive intact.
    expect(out.required_trades).toEqual(["HVAC"]);
    expect(out.estimated_value).toBe("$400,000");
  });

  it("handles an analysis missing the optional long-form fields", () => {
    const out = tightenAnalysisProse({ required_trades: ["Electrical"] } as never);
    expect(out).toEqual({ required_trades: ["Electrical"] });
  });
});
