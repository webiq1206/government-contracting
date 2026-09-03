import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The sweep's own rules, checked against the pages they judge.
 *
 * scripts/edge-case-sweep.ts drives a browser over three throwaway accounts
 * and reports what looks wrong. It is the only check on this product that
 * reads a rendered page as a person would, and its findings get acted on, so a
 * rule that fires on correct output costs more than no rule: four such
 * findings sat in the report for weeks, and the page they accused was right.
 *
 * The regex is read out of the script rather than copied, so this cannot pass
 * against a rule the sweep no longer uses.
 */
const SRC = readFileSync("scripts/edge-case-sweep.ts", "utf8");

function rule(name: string): RegExp {
  const m = new RegExp(`const ${name} = (/.*/i);`).exec(SRC);
  if (!m) throw new Error(`${name} moved or was renamed; this guard needs updating`);
  // eslint-disable-next-line no-eval
  return eval(m[1]) as RegExp;
}

/**
 * How the probe assembles page text: each leaf element's text, joined with a
 * separator the rules do not read across. Reproduced here because the rules
 * are only correct in combination with it -- on raw textContent, a label
 * ending one element and a number starting the next arrive as one word.
 */
function pageText(elements: string[]): string {
  return elements.map((e) => e.replace(/\s+/g, " ").trim()).join(" | ");
}

describe("the unknown-as-zero rule", () => {
  const UNKNOWN_AS_ZERO = rule("UNKNOWN_AS_ZERO");

  it("reads a figure and a caption as the separate things they are", () => {
    /*
     * The four findings this replaces, all one false positive. A metric card
     * prints its label, then its value, then how many records back it. On
     * textContent those fused into "...published value0%Based on 0", and the
     * rule matched the 0 in the caption. The figure was 0% because none of the
     * open work carried a published value, which is true, and the caption
     * exists to say so.
     */
    for (const need of [1, 41]) {
      const text = pageText([
        "Open work with a published value",
        "0%",
        `Based on 0 of ${need} records`,
      ]);
      expect(UNKNOWN_AS_ZERO.test(text), text).toBe(false);
    }
  });

  it("still catches a derived figure printed as a nought", () => {
    // The case the rule exists for, and the reason it cannot simply be
    // deleted: these are one element, so no separator saves them.
    for (const line of [
      "Fit score 0 out of 100",
      "Data confidence 0",
      "Win rate 0 this quarter",
    ]) {
      expect(UNKNOWN_AS_ZERO.test(pageText([line])), line).toBe(true);
    }
  });

  it("leaves an honest zero alone", () => {
    // Zero replies really is zero. Flagging it would bury the case above.
    expect(UNKNOWN_AS_ZERO.test(pageText(["Replies", "0"]))).toBe(false);
    expect(UNKNOWN_AS_ZERO.test(pageText(["Win rate", "29.3%"]))).toBe(false);
  });
});

describe("the probe the rules read", () => {
  it("joins elements with a separator instead of concatenating them", () => {
    /*
     * Structural, because the rules above are only right in combination with
     * it. Dropping back to textContent reinstates all four findings.
     */
    expect(SRC).toContain('.join(" | ")');
    expect(SRC).not.toMatch(/text:\s*\(main\.textContent/);
  });

  it("excludes that separator from the gap the rule scans", () => {
    expect(SRC).toContain("[^.<|]{0,24}");
  });
});
