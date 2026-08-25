/**
 * The vocabulary, and the rule that keeps it.
 *
 * A terminology library nothing checks is a terminology library that lasts one
 * busy afternoon. The scan at the bottom is the part that matters: it holds
 * the line the same way tests/no-em-dash.test.ts does, by failing the build
 * rather than by being remembered.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  DEADLINE_TERMS,
  MONEY_TERMS,
  NO_QUOTE_TERMS,
  VALUE_BASIS_TERMS,
  VAGUE_STATUSES,
  formatCount,
  valueStateLabel,
} from "@/lib/domain/terminology";

describe("the two deadlines", () => {
  it("never calls either one just 'the deadline'", () => {
    /*
     * A subcontractor was once handed the government's date as if it were
     * their own, which is how a quote arrives the same hour the bid is due.
     */
    for (const term of Object.values(DEADLINE_TERMS)) {
      expect(term.label.toLowerCase()).not.toBe("deadline");
      expect(term.short.toLowerCase()).not.toBe("deadline");
    }
    expect(DEADLINE_TERMS.government.label).toContain("submission");
    expect(DEADLINE_TERMS.quote.label).toContain("quote");
  });

  it("says the quote date comes first", () => {
    expect(DEADLINE_TERMS.quote.description).toMatch(/earlier than the submission/i);
  });
});

describe("money words", () => {
  it("distinguishes markup from margin by what they are a percentage of", () => {
    // The two are computed from the same figures and are never equal.
    expect(MONEY_TERMS.markup.description).toMatch(/OF COST/);
    expect(MONEY_TERMS.margin.description).toMatch(/OF THE BID PRICE/);
  });

  it("carries the worked example that makes the difference obvious", () => {
    expect(MONEY_TERMS.markup.description).toContain("20%");
    expect(MONEY_TERMS.margin.description).toContain("16.7%");
  });

  it("separates a stated value from an inferred one", () => {
    expect(VALUE_BASIS_TERMS.known.description).toMatch(/fact/i);
    expect(VALUE_BASIS_TERMS.modeled.description).toMatch(/guess|inference|can be wrong/i);
  });
});

describe("why a subcontractor did not quote", () => {
  it("keeps the five reasons distinct and gives each its own next action", () => {
    const reasons = Object.values(NO_QUOTE_TERMS);
    expect(reasons).toHaveLength(5);
    const actions = new Set(reasons.map((r) => r.nextAction));
    expect(actions.size).toBe(5);
  });

  it("does not treat a bounce as a decision the firm made", () => {
    expect(NO_QUOTE_TERMS.delivery_failed.description).toMatch(/never reached a person/i);
    expect(NO_QUOTE_TERMS.delivery_failed.nextAction).toMatch(/not a decision/i);
  });

  it("separates silence from refusal", () => {
    expect(NO_QUOTE_TERMS.no_response.description).toMatch(/Silence, not refusal/i);
  });
});

describe("formatCount", () => {
  it("never shows an unknown as zero", () => {
    // The quiet lie: nobody questions a zero.
    expect(formatCount(null, "unknown")).toBe("Unknown");
    expect(formatCount(undefined, "not_calculated")).toBe("Not calculated yet");
    expect(formatCount(null, "zero")).toBe("Unknown");
  });

  it("shows a real zero as zero when the caller says it counted", () => {
    expect(formatCount(0, "zero")).toBe("0");
  });

  it("says 'None' for a counted zero when that reads better", () => {
    expect(formatCount(0, "none")).toBe("None");
  });

  it("passes real numbers straight through", () => {
    expect(formatCount(7, "zero")).toBe("7");
    expect(formatCount(7, "unknown")).toBe("7");
  });

  it("distinguishes a permission block from an absence", () => {
    expect(valueStateLabel("no_permission")).toMatch(/permissions/i);
    expect(valueStateLabel("not_applicable")).toBe("Not applicable");
  });
});

// ---------------------------------------------------------------------------

const ROOTS = ["app", "components"];
const SKIP = /theme-qa|\.test\.tsx?$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * A JSX string that a person will read, as opposed to a class name, a route,
 * an aria value or a comparison against stored data.
 *
 * Deliberately narrow. The interesting case is a status STRING rendered as a
 * status -- `status="Pending"`, `<span>Processing</span>` -- not the word
 * appearing anywhere in a file, which would flag `stage === "pending"` and
 * every code path that reads one.
 */
function vagueStatusHits(src: string): { word: string; line: number }[] {
  const hits: { word: string; line: number }[] = [];
  const lines = src.split("\n");
  for (const word of Object.keys(VAGUE_STATUSES)) {
    const asProp = new RegExp(`\\bstatus=(?:"${word}"|\\{"${word}"\\})`, "i");
    const asOnlyChild = new RegExp(`>\\s*${word}\\s*<`, "i");
    lines.forEach((line, i) => {
      if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) return;
      if (asProp.test(line) || asOnlyChild.test(line)) hits.push({ word, line: i + 1 });
    });
  }
  return hits;
}

describe("no vague statuses in the interface", () => {
  const files = ROOTS.flatMap((r) => walk(join(process.cwd(), r))).filter(
    (f) => !SKIP.test(f)
  );

  it("has files to scan", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("finds none", () => {
    const found: string[] = [];
    for (const file of files) {
      for (const hit of vagueStatusHits(readFileSync(file, "utf8"))) {
        found.push(
          `${relative(process.cwd(), file)}:${hit.line} "${hit.word}" -- ${VAGUE_STATUSES[hit.word]}`
        );
      }
    }
    expect(found).toEqual([]);
  });
});
