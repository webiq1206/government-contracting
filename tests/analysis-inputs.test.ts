/**
 * Telling an amendment apart from a repeated button press.
 *
 * This gate decides whether the largest Claude call in the system runs again.
 * Both ways of being wrong cost something, and they are not symmetric: a
 * false "changed" re-bills one analysis, while a false "unchanged" means a
 * real amendment is never read and the bid is built against superseded
 * requirements. The tests lean accordingly.
 */
import { describe, it, expect } from "vitest";
import { analysisInputHash, inputsUnchanged } from "@/lib/domain/analysis-inputs";

const BASE = {
  title: "Rooftop Unit Replacement",
  solicitationNumber: "W912DR-26-R-0042",
  description: "Replace 12 rooftop units across Buildings 3 and 4.",
  documents: [
    { name: "Statement of Work.pdf", storagePath: "doc-1:s/sow.pdf:v1", updatedAt: "2026-08-01" },
    { name: "Drawings.pdf", storagePath: "doc-2:s/dwg.pdf:v1", updatedAt: "2026-08-01" },
  ],
};

describe("analysisInputHash", () => {
  it("is stable for identical inputs", () => {
    expect(analysisInputHash(BASE)).toBe(analysisInputHash({ ...BASE }));
  });

  it("ignores the order documents come back in", () => {
    /*
     * The order is a property of the query, not of the solicitation. Without
     * this, a plan change that reordered rows would look like an amendment on
     * every opportunity at once and re-bill the entire pipeline.
     */
    const reversed = { ...BASE, documents: [...BASE.documents].reverse() };
    expect(analysisInputHash(reversed)).toBe(analysisInputHash(BASE));
  });

  it("changes when a document is added", () => {
    const withAmendment = {
      ...BASE,
      documents: [
        ...BASE.documents,
        { name: "Amendment 0001.pdf", storagePath: "doc-3:s/a1.pdf:v1", updatedAt: "2026-08-10" },
      ],
    };
    expect(analysisInputHash(withAmendment)).not.toBe(analysisInputHash(BASE));
  });

  it("changes when a document is removed", () => {
    const fewer = { ...BASE, documents: [BASE.documents[0]] };
    expect(analysisInputHash(fewer)).not.toBe(analysisInputHash(BASE));
  });

  it("changes when a file is replaced under the same name", () => {
    // The row id is carried in storagePath precisely for this case: an
    // identical filename pointing at new content must not hash the same.
    const replaced = {
      ...BASE,
      documents: [
        { ...BASE.documents[0], storagePath: "doc-9:s/sow.pdf:v2", updatedAt: "2026-08-12" },
        BASE.documents[1],
      ],
    };
    expect(analysisInputHash(replaced)).not.toBe(analysisInputHash(BASE));
  });

  it("changes when the agency edits the notice text", () => {
    expect(
      analysisInputHash({ ...BASE, description: "Replace 14 rooftop units." })
    ).not.toBe(analysisInputHash(BASE));
  });

  it("changes when the solicitation number is corrected", () => {
    expect(
      analysisInputHash({ ...BASE, solicitationNumber: "W912DR-26-R-0043" })
    ).not.toBe(analysisInputHash(BASE));
  });

  it("distinguishes no documents from one document", () => {
    expect(analysisInputHash({ ...BASE, documents: [] })).not.toBe(analysisInputHash(BASE));
  });
});

describe("inputsUnchanged", () => {
  it("says unchanged only when the hashes match", () => {
    const h = analysisInputHash(BASE);
    expect(inputsUnchanged(h, h)).toBe(true);
    expect(inputsUnchanged("something-else", h)).toBe(false);
  });

  it("treats a missing stored hash as changed", () => {
    /*
     * Every analysis written before this column existed has no hash. Reading
     * that as "unchanged" would freeze those opportunities on their original
     * brief forever. One extra analysis writes the hash and makes every later
     * forced run cheap.
     */
    expect(inputsUnchanged(null, analysisInputHash(BASE))).toBe(false);
    expect(inputsUnchanged(undefined, analysisInputHash(BASE))).toBe(false);
    expect(inputsUnchanged("", analysisInputHash(BASE))).toBe(false);
  });
});
