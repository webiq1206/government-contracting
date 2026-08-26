import { describe, expect, it } from "vitest";
import {
  amendmentNumber,
  classifyDocumentName,
  extractionIsComplete,
  inventoryCoverage,
  parseAccessState,
  parseDisposition,
  parseDocumentClass,
  parseExtractionState,
  parseOcrState,
  type InventoryRow,
} from "../lib/domain/document-inventory";

describe("guessing what a document is", () => {
  it.each([
    ["Amendment 0002.pdf", "amendment"],
    ["SOL-123 Modification 3.pdf", "amendment"],
    ["Addendum No 1.docx", "amendment"],
    ["Wage Determination WD-2015-4321.pdf", "wage_determination"],
    ["Davis-Bacon rates.pdf", "wage_determination"],
    ["Bid Schedule.xlsx", "pricing_schedule"],
    ["Pricing Sheet.xlsx", "pricing_schedule"],
    ["SF-1449.pdf", "form"],
    ["Representations and Certifications.pdf", "form"],
    ["Site Plan.dwg", "drawing"],
    ["Drawing Set 2024.pdf", "drawing"],
    ["Vicinity Map.pdf", "map"],
    ["Photo 3.jpg", "photo"],
    ["Technical Specifications Division 23.pdf", "specification"],
    ["Exhibit B.pdf", "exhibit"],
    ["PWS.pdf", "solicitation"],
    ["Statement of Work.docx", "solicitation"],
    ["Solicitation Package.zip", "archive"],
    ["attachment", "other"],
  ])("reads %s as %s", (name, expected) => {
    expect(classifyDocumentName(name)).toBe(expected);
  });

  it("lets the specific label win over the general one", () => {
    // "Amendment 0002 to the Wage Determination" is an amendment. Getting
    // this backwards would file the document that CHANGED the requirements
    // under the requirements it changed.
    expect(classifyDocumentName("Amendment 0002 - Wage Determination.pdf")).toBe("amendment");
  });

  it("uses the content type when the name says nothing", () => {
    // SAM labels almost every resourceLink "attachment", so this is the
    // common case rather than the edge case.
    expect(classifyDocumentName("attachment", "application/zip")).toBe("archive");
    expect(classifyDocumentName("attachment", "image/jpeg")).toBe("photo");
  });
});

describe("amendment numbers", () => {
  it.each([
    ["Amendment 0002.pdf", 2],
    ["Amend 11.pdf", 11],
    ["Modification No. 3.pdf", 3],
    ["Addendum 1", 1],
  ])("reads %s as %s", (name, n) => {
    expect(amendmentNumber(name)).toBe(n);
  });

  it("returns null, not zero, when there is no amendment number", () => {
    // A solicitation has no amendment number. "Amendment 0" is a different
    // fact, and a base document sorting alongside amendment zero would be
    // wrong in the one place ordering matters.
    expect(amendmentNumber("Solicitation.pdf")).toBeNull();
    expect(amendmentNumber("Amendment 0000.pdf")).toBe(0);
  });
});

describe("parsing a value out of the database", () => {
  it("falls back to the pessimistic value every time", () => {
    /*
     * A row written by an older version of this code, or by a migration that
     * had to guess, must never read as "everything is fine" because a column
     * was empty. Each of these defaults to the state that makes somebody
     * look.
     */
    expect(parseDisposition(null)).toBe("blocked");
    expect(parseExtractionState(undefined)).toBe("pending");
    expect(parseOcrState("")).toBe("pending");
    expect(parseAccessState("nonsense")).toBe("unreachable");
    expect(parseDocumentClass(42)).toBe("other");
  });

  it("accepts the values it wrote", () => {
    expect(parseDisposition("delivered_via_link")).toBe("delivered_via_link");
    expect(parseExtractionState("EXTRACTED")).toBe("extracted");
  });
});

describe("what counts as read", () => {
  it("treats partly read and not read as not read", () => {
    // These are not degrees of success. Each one means a requirement could be
    // sitting in that file unseen.
    expect(extractionIsComplete("extracted")).toBe(true);
    expect(extractionIsComplete("not_applicable")).toBe(true);
    for (const s of ["partial", "not_read", "unreadable", "pending"] as const) {
      expect(extractionIsComplete(s), s).toBe(false);
    }
  });
});

const row = (over: Partial<InventoryRow>): InventoryRow => ({
  id: "d1",
  name: "PWS.pdf",
  documentClass: "solicitation",
  disposition: "delivered",
  extractionState: "extracted",
  excludedReason: null,
  ...over,
});

describe("inventory coverage", () => {
  it("is complete only when every file is accounted for", () => {
    const cov = inventoryCoverage([row({}), row({ id: "d2", extractionState: "not_applicable" })]);
    expect(cov.complete).toBe(true);
    expect(cov.summary).toBe("All 2 document(s) accounted for.");
  });

  it("is not complete when one document was stored but never read", () => {
    const cov = inventoryCoverage([row({}), row({ id: "d2", extractionState: "not_read" })]);
    expect(cov.complete).toBe(false);
    expect(cov.notRead).toBe(1);
    expect(cov.summary).toContain("1 stored but not read");
  });

  it("is not complete on an empty inventory", () => {
    // Zero documents is not the same as zero problems. A solicitation with no
    // source files at all is a solicitation nobody has collected.
    const cov = inventoryCoverage([]);
    expect(cov.complete).toBe(false);
    expect(cov.summary).toBe("No source documents on this opportunity.");
  });

  it("refuses to count an exclusion that gives no reason", () => {
    /*
     * This is the whole point of the disposition column. An exclusion with a
     * reason is a decision somebody can argue with. An exclusion with no
     * reason is indistinguishable from a file that was quietly lost, which is
     * exactly the state this inventory exists to make impossible.
     */
    const withReason = inventoryCoverage([
      row({ disposition: "excluded", excludedReason: "Duplicate of Attachment 2." }),
    ]);
    expect(withReason.complete).toBe(true);

    const without = inventoryCoverage([row({ disposition: "excluded", excludedReason: "   " })]);
    expect(without.complete).toBe(false);
    expect(without.summary).toContain("excluded with no reason given");
  });

  it("counts a blocking failure as blocking", () => {
    const cov = inventoryCoverage([row({}), row({ id: "d2", disposition: "blocked" })]);
    expect(cov.complete).toBe(false);
    expect(cov.blocked).toBe(1);
    expect(cov.summary).toContain("1 could not be collected");
  });

  it("reports every problem at once rather than the first one", () => {
    const cov = inventoryCoverage([
      row({ id: "a", extractionState: "partial" }),
      row({ id: "b", extractionState: "not_read" }),
      row({ id: "c", extractionState: "unreadable" }),
      row({ id: "d", disposition: "blocked" }),
      row({ id: "e", extractionState: "pending" }),
    ]);
    for (const phrase of [
      "could not be collected",
      "stored but not read",
      "unreadable",
      "only partly read",
      "not processed yet",
    ]) {
      expect(cov.summary, phrase).toContain(phrase);
    }
  });
});
