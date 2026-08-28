import { describe, it, expect } from "vitest";
import {
  selectDocumentsForTrade,
  namesAnotherTrade,
  looksPrimeOnly,
  describeOmissions,
} from "../lib/domain/attachment-selection";

const doc = (name: string, extra: Record<string, unknown> = {}) => ({ name, ...extra });

describe("selectDocumentsForTrade", () => {
  it("keeps the documents that govern every trade, whatever their names say", () => {
    const docs = [
      doc("FA466126Q0027.pdf"),
      doc("FA466126Q0027P00001_-_Amendment_1.pdf"),
      doc("Attachment_2._Wage_Determination.pdf"),
      doc("Attachment_5_Pricing_Schedule.docx"),
      doc("Attachment_11._Questions_and_Answers.pdf"),
      doc("Attachment_6._Dyess_AFB_Vindicator_IDIQ_SOW_CAO_17_Jul_2026.pdf"),
    ];
    const { included, omitted } = selectDocumentsForTrade(docs, "Electrical");
    expect(included).toEqual(docs);
    expect(omitted).toEqual([]);
  });

  it("keeps an amendment even when its name carries another trade's word", () => {
    const { included } = selectDocumentsForTrade(
      [doc("Amendment 2 - Electrical Panel Clarification.pdf")],
      "Plumbing"
    );
    expect(included).toHaveLength(1);
  });

  it("leaves another trade's specifications out, with a reason", () => {
    const { included, omitted } = selectDocumentsForTrade(
      [doc("Electrical Specifications.pdf"), doc("Plumbing Riser Drawings.pdf")],
      "Plumbing"
    );
    expect(included.map((d) => d.name)).toEqual(["Plumbing Riser Drawings.pdf"]);
    expect(omitted).toHaveLength(1);
    expect(omitted[0].reason).toMatch(/electrical work, not Plumbing/);
  });

  it("keeps a generic drawing set: no marker means no confident omission", () => {
    const { included, omitted } = selectDocumentsForTrade(
      [doc("Drawings.pdf"), doc("Site Plan Sheet A1.pdf")],
      "Roofing"
    );
    expect(included).toHaveLength(2);
    expect(omitted).toEqual([]);
  });

  it("keeps a document that names both this trade and another", () => {
    const { included } = selectDocumentsForTrade(
      [doc("Mechanical and Electrical Specifications.pdf")],
      "Electrical"
    );
    expect(included).toHaveLength(1);
  });

  it("leaves the prime's offer-submission material out for every trade", () => {
    const docs = [
      doc("Attachment_1._RFO_Provisions_and_Clauses.pdf"),
      doc("Attachment_4._Sections_L_26_M.pdf"),
      doc("Instructions to Offerors.pdf"),
    ];
    const { included, omitted } = selectDocumentsForTrade(docs, "HVAC");
    expect(included).toEqual([]);
    expect(omitted).toHaveLength(3);
    for (const o of omitted) expect(o.reason).toMatch(/prime contractor/);
  });

  it("honours the analysis's explicit relevance, both directions", () => {
    const docs = [
      doc("Electrical Specifications.pdf", { relevantToAll: true }),
      doc("Finish Schedule.pdf", { tradeRelevance: ["Painting", "Flooring"] }),
      doc("Roof Details.pdf", { tradeRelevance: ["Roofing"] }),
    ];
    const { included, omitted } = selectDocumentsForTrade(docs, "Painting");
    // relevant_to_all overrides the name; the tagged doc matches; the
    // roofing-tagged doc is out even though nothing else would have cut it.
    expect(included.map((d) => d.name)).toEqual([
      "Electrical Specifications.pdf",
      "Finish Schedule.pdf",
    ]);
    expect(omitted[0].reason).toMatch(/Roofing, not to Painting/);
  });

  it("matches stored trade tags across family synonyms", () => {
    const { included } = selectDocumentsForTrade(
      [doc("Chiller Cut Sheets.pdf", { tradeRelevance: ["HVAC"] })],
      "Mechanical"
    );
    expect(included).toHaveLength(1);
  });

  it("with no trade, keeps everything except the prime-only material", () => {
    const { included, omitted } = selectDocumentsForTrade(
      [doc("Electrical Specifications.pdf"), doc("Instructions to Offerors.pdf")],
      ""
    );
    expect(included.map((d) => d.name)).toEqual(["Electrical Specifications.pdf"]);
    expect(omitted).toHaveLength(1);
  });

  it("includes when the subcontractor's trade is one this table does not know", () => {
    const { included, omitted } = selectDocumentsForTrade(
      [doc("Electrical Specifications.pdf"), doc("Vindicator Head End Unit SOW.pdf")],
      "Vindicator maintenance"
    );
    // Cannot rule the electrical spec out for a trade we cannot place, so it
    // rides along: the failure mode must be an extra file, never a missing one.
    expect(included).toHaveLength(2);
    expect(omitted).toEqual([]);
  });
});

describe("namesAnotherTrade", () => {
  it("is confident only when a marker fires and none of the sub's do", () => {
    expect(namesAnotherTrade("Electrical Specs.pdf", "Plumbing")).toEqual({
      other: true,
      label: "electrical",
    });
    expect(namesAnotherTrade("Cover Letter.pdf", "Plumbing").other).toBe(false);
    expect(namesAnotherTrade("Plumbing Fixtures.pdf", "Plumbing").other).toBe(false);
  });

  it("does not read 'Air Force Base' as an HVAC document", () => {
    expect(namesAnotherTrade("Dyess AFB Site Access.pdf", "Roofing").other).toBe(false);
  });
});

describe("looksPrimeOnly", () => {
  it("recognises the usual shapes, underscores and mangling included", () => {
    expect(looksPrimeOnly("RFO_Provisions_and_Clauses.pdf")).toBe(true);
    expect(looksPrimeOnly("Sections_L_26_M.pdf")).toBe(true);
    expect(looksPrimeOnly("Representations and Certifications.docx")).toBe(true);
  });

  it("does not fire on the documents a sub does need", () => {
    expect(looksPrimeOnly("Statement of Work.pdf")).toBe(false);
    expect(looksPrimeOnly("Wage Determination.pdf")).toBe(false);
    expect(looksPrimeOnly("Section H.pdf")).toBe(false);
    expect(looksPrimeOnly("Pricing Schedule.xlsx")).toBe(false);
  });
});

describe("describeOmissions", () => {
  it("joins reasons into log-ready sentences", () => {
    expect(describeOmissions([{ reason: "a" }, { reason: "b" }])).toBe("a. b.");
  });
});
