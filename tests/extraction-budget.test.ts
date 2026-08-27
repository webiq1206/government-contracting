import { describe, expect, it } from "vitest";
import {
  allocateExtractionBudget,
  coverageSummary,
  MIN_USEFUL_CHARS,
  assembleAttachmentContext,
} from "../lib/domain/extraction-budget";

const doc = (id: string, chars: number) => ({ id, name: id, chars });

describe("sharing the analysis budget", () => {
  it("passes everything through when it all fits", () => {
    const plan = allocateExtractionBudget([doc("a", 1_000), doc("b", 2_000)], 240_000);
    expect(plan.complete).toBe(true);
    expect(plan.totalIncluded).toBe(3_000);
    expect(plan.omitted).toEqual([]);
  });

  it("never spends more than the budget", () => {
    const docs = Array.from({ length: 60 }, (_, i) => doc(`d${i}`, 50_000));
    const plan = allocateExtractionBudget(docs, 240_000);
    expect(plan.totalIncluded).toBeLessThanOrEqual(240_000);
  });

  it("gives a short document what it needs and the rest to a long one", () => {
    // The whole point of water-filling. An equal split would give the wage
    // determination 120,000 characters it has no use for and cut the
    // specification in half for nothing.
    const plan = allocateExtractionBudget([doc("wage", 1_200), doc("spec", 500_000)], 240_000);
    const wage = plan.allocations.find((a) => a.id === "wage")!;
    const spec = plan.allocations.find((a) => a.id === "spec")!;
    expect(wage.included).toBe(1_200);
    expect(wage.trimmed).toBe(false);
    expect(spec.included).toBe(238_800);
    expect(spec.trimmed).toBe(true);
    expect(plan.totalIncluded).toBe(240_000);
  });

  it("does not let one enormous file starve the others", () => {
    const plan = allocateExtractionBudget(
      [doc("huge", 10_000_000), doc("b", 30_000), doc("c", 30_000)],
      240_000
    );
    for (const id of ["b", "c"]) {
      expect(plan.allocations.find((a) => a.id === id)!.included).toBe(30_000);
    }
    expect(plan.allocations.find((a) => a.id === "huge")!.included).toBe(180_000);
  });

  it("leaves a document out loudly rather than dribbling a paragraph of it", () => {
    /*
     * Two hundred documents against a 240,000 budget is 1,200 characters each.
     * A 1,200-character excerpt of a specification is its cover page. A
     * requirement read out of that is a requirement invented, so the document
     * is reported as left out instead.
     */
    const docs = Array.from({ length: 200 }, (_, i) => doc(`d${i}`, 40_000));
    const plan = allocateExtractionBudget(docs, 240_000);
    expect(plan.omitted.length).toBe(200);
    expect(plan.totalIncluded).toBe(0);
    expect(plan.complete).toBe(false);
  });

  it("counts a short document as read in full even below the useful floor", () => {
    // A 300-character addendum is a complete addendum, not a fragment.
    const plan = allocateExtractionBudget([doc("note", 300)], 240_000);
    expect(plan.allocations[0].included).toBe(300);
    expect(plan.allocations[0].omitted).toBe(false);
    expect(plan.complete).toBe(true);
  });

  it("blames extraction, not the budget, for a document with no text", () => {
    const plan = allocateExtractionBudget([doc("scan", 0), doc("spec", 10_000)], 240_000);
    expect(plan.omitted).toEqual([]);
    expect(plan.complete).toBe(true);
  });

  it("handles no documents at all", () => {
    const plan = allocateExtractionBudget([], 240_000);
    expect(plan.complete).toBe(true);
    expect(coverageSummary(plan)).toContain("0 of 0");
  });

  it("uses the useful floor it is given", () => {
    const docs = Array.from({ length: 10 }, (_, i) => doc(`d${i}`, 100_000));
    const lenient = allocateExtractionBudget(docs, 240_000, 1_000);
    const strict = allocateExtractionBudget(docs, 240_000, 50_000);
    expect(lenient.omitted.length).toBe(0);
    expect(strict.omitted.length).toBe(10);
    expect(MIN_USEFUL_CHARS).toBe(2_000);
  });
});

describe("what the coverage line says", () => {
  it("names the documents that were left out", () => {
    const plan = allocateExtractionBudget(
      Array.from({ length: 200 }, (_, i) => doc(`Attachment ${i}`, 40_000)),
      240_000
    );
    const line = coverageSummary(plan);
    expect(line).toContain("left out entirely");
    expect(line).toContain("Attachment 0");
  });

  it("says how many were shortened, separately from how many were dropped", () => {
    const plan = allocateExtractionBudget([doc("wage", 1_000), doc("spec", 900_000)], 240_000);
    const line = coverageSummary(plan);
    expect(line).toContain("1 of 2 document(s) read in full");
    expect(line).toContain("1 shortened to fit");
    expect(line).not.toContain("left out");
  });

  it("does not claim anything when nothing needed saying", () => {
    const plan = allocateExtractionBudget([doc("a", 10)], 240_000);
    expect(coverageSummary(plan)).toBe("1 of 1 document(s) read in full");
  });
});

describe("assembling the prompt text", () => {
  const item = (name: string, chars: number) => ({ name, context: "x".repeat(chars) });
  const BUDGET = 240_000;

  it("processes far more than forty documents without losing one", () => {
    /*
     * The requirement this replaces was `.slice(0, 40)`. Fifty-seven
     * attachments on a notice meant forty analysed and seventeen gone, with
     * no record that they existed. SAM appends amendments and Q and A
     * responses AFTER the base documents, so the seventeen that vanished were
     * the ones most likely to have changed the requirements.
     *
     * Every document must now appear in the plan, whether or not its text
     * fit.
     */
    const items = Array.from({ length: 57 }, (_, i) => item(`Attachment ${i + 1}`, 12_000));
    const { text, plan } = assembleAttachmentContext(items, BUDGET);
    expect(plan.allocations).toHaveLength(57);
    for (const i of [1, 40, 41, 57]) {
      expect(text).toContain(`Attachment ${i}`);
    }
  });

  it("names a document it could not read instead of dropping it", () => {
    const items = Array.from({ length: 300 }, (_, i) => item(`Amendment ${i + 1}`, 40_000));
    const { text, plan } = assembleAttachmentContext(items, BUDGET);
    expect(plan.omitted.length).toBeGreaterThan(0);
    expect(text).toContain("Amendment 300");
    expect(text).toContain("STORED BUT NOT READ");
    expect(text).toContain("Do NOT state or assume anything about its contents");
  });

  it("tells the model where a trimmed document stops", () => {
    const { text } = assembleAttachmentContext(
      [item("Wage Determination", 500), item("Specifications", 900_000)],
      BUDGET
    );
    expect(text).toContain("Specifications continues past this point and was NOT read");
    // The short one is whole, so it carries no warning of its own.
    expect(text).not.toContain("Wage Determination continues past");
  });

  it("stays inside the budget however many documents arrive", () => {
    // The property the old code broke: an 8,000-character floor per document
    // with no ceiling on the total, and a final slice that quietly cut the
    // tail. Whatever the shape of the input, the assembled text fits.
    for (const n of [1, 5, 39, 40, 41, 120, 500]) {
      const items = Array.from({ length: n }, (_, i) => item(`d${i}`, 50_000));
      const { text } = assembleAttachmentContext(items, BUDGET);
      expect(text.length, `${n} documents`).toBeLessThanOrEqual(BUDGET);
    }
  });

  it("leaves a normal solicitation completely untouched", () => {
    const items = [item("Solicitation", 40_000), item("Wage Determination", 3_000)];
    const { text, plan } = assembleAttachmentContext(items, BUDGET);
    expect(plan.complete).toBe(true);
    expect(text).toBe(`${items[0].context}\n\n${items[1].context}`);
  });

  it("says nothing at all for no attachments", () => {
    const { text, plan } = assembleAttachmentContext([], BUDGET);
    expect(text).toBe("");
    expect(plan.complete).toBe(true);
  });
});
