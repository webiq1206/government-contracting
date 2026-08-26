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
  resolveCitation,
  withPageMarkers,
  documentChanges,
  changeSummary,
  type InventoryRow,
  type InventorySnapshot,
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

describe("resolving a citation to something openable", () => {
  const docs = [
    { id: "d1", name: "Attachment 2 - Wage Determination.pdf", pageCount: 12 },
    { id: "d2", name: "PWS.pdf", pageCount: 210 },
    { id: "d3", name: "SF-1449.pdf", pageCount: null },
  ];

  it("matches the exact name the model was shown", () => {
    const c = resolveCitation("PWS.pdf", 45, docs);
    expect(c.documentId).toBe("d2");
    expect(c.page).toBe(45);
    expect(c.problem).toBeNull();
  });

  it("matches on a partial name when only one document can be meant", () => {
    const c = resolveCitation("Attachment 2", 3, docs);
    expect(c.documentId).toBe("d1");
  });

  it("refuses to guess when two documents could be meant", () => {
    /*
     * Attributing a page limit to the wrong document sends somebody to read
     * the wrong file and come away confident. Saying the citation could not
     * be resolved is the smaller harm by a wide margin.
     */
    const ambiguous = [
      { id: "a", name: "Amendment 0001.pdf", pageCount: 2 },
      { id: "b", name: "Amendment 0002.pdf", pageCount: 2 },
    ];
    const c = resolveCitation("Amendment", 1, ambiguous);
    expect(c.documentId).toBeNull();
    expect(c.problem).toBe("unknown_document");
  });

  it("says so when the model named a document that does not exist", () => {
    const c = resolveCitation("Section L Instructions.pdf", 2, docs);
    expect(c.documentId).toBeNull();
    expect(c.documentName).toBe("Section L Instructions.pdf");
    expect(c.problem).toBe("unknown_document");
  });

  it("drops a page number past the end of the document, keeping the document", () => {
    // A page past the end is a page the model made up, and a link to it opens
    // on nothing.
    const c = resolveCitation("Attachment 2 - Wage Determination.pdf", 400, docs);
    expect(c.documentId).toBe("d1");
    expect(c.page).toBeNull();
    expect(c.problem).toBe("page_out_of_range");
  });

  it("keeps a page number when the page count is unknown", () => {
    // Unknown is not zero. Refusing the page because the count was never
    // recorded would throw away a citation that is probably right.
    const c = resolveCitation("SF-1449.pdf", 2, docs);
    expect(c.page).toBe(2);
    expect(c.problem).toBeNull();
  });

  it("reports a missing citation as missing rather than inventing one", () => {
    for (const bad of ["", "   ", null, undefined, 7]) {
      const c = resolveCitation(bad, 3, docs);
      expect(c.documentId).toBeNull();
      expect(c.problem).toBe("no_citation");
    }
  });

  it("ignores a page number that is not a real page", () => {
    for (const bad of [0, -2, 1.5, "12", null]) {
      expect(resolveCitation("PWS.pdf", bad, docs).page).toBeNull();
    }
  });
});

describe("page markers", () => {
  it("numbers pages from the document, not from the ones with text on them", () => {
    /*
     * The blank second page is what makes this worth a test. Renumbering
     * around it would label the third page as page two, and every citation
     * into the rest of the document would be confidently one page out.
     */
    expect(withPageMarkers(["cover", "", "Section L"])).toBe("[p.1]\ncover\n\n[p.3]\nSection L");
  });

  it("spends nothing on pages with nothing on them", () => {
    expect(withPageMarkers(["", "   ", "\n"])).toBe("");
    expect(withPageMarkers([])).toBe("");
  });
});

describe("what moved since the last read", () => {
  const snap = (over: Partial<InventorySnapshot>): InventorySnapshot => ({
    key: "solicitations/o1/1_pws.pdf",
    name: "PWS.pdf",
    contentHash: "aaa",
    documentClass: "solicitation",
    amendmentNumber: null,
    ...over,
  });

  it("sees a file re-issued under the same name with different bytes", () => {
    /*
     * The quiet change, and the reason this compares hashes at all. An agency
     * replaces a file in place: same name, same count, same list. Every
     * requirement extracted from the old version is now describing a document
     * that no longer exists, and nothing about the document list looks any
     * different.
     */
    const changes = documentChanges([snap({})], [snap({ contentHash: "bbb" })]);
    expect(changes.changed).toHaveLength(1);
    expect(changes.quiet).toBe(false);
    expect(changeSummary(changes)).toContain("re-issued with different content");
  });

  it("is quiet when nothing moved", () => {
    const changes = documentChanges([snap({})], [snap({})]);
    expect(changes.quiet).toBe(true);
    expect(changes.unchanged).toBe(1);
    expect(changeSummary(changes)).toBe("No change to the 1 source document(s).");
  });

  it("reports a new amendment as an arrival, not a replacement", () => {
    /*
     * Federal amendments are cumulative: Amendment 0002 does not cancel
     * Amendment 0001, and treating it as a replacement would hide a document
     * that is still binding on the bid.
     */
    const before = [snap({}), snap({ key: "k-a1", name: "Amendment 0001.pdf", documentClass: "amendment", amendmentNumber: 1 })];
    const after = [
      ...before,
      snap({ key: "k-a2", name: "Amendment 0002.pdf", documentClass: "amendment", amendmentNumber: 2 }),
    ];
    const changes = documentChanges(before, after);
    expect(changes.newAmendments.map((a) => a.name)).toEqual(["Amendment 0002.pdf"]);
    expect(changes.changed).toHaveLength(0);
    expect(changes.removed).toHaveLength(0);
    expect(changeSummary(changes)).toContain("1 new amendment(s): Amendment 0002.pdf");
  });

  it("orders new amendments with the latest first", () => {
    const after = [
      snap({ key: "k-a1", name: "Amendment 0001.pdf", documentClass: "amendment", amendmentNumber: 1 }),
      snap({ key: "k-a3", name: "Amendment 0003.pdf", documentClass: "amendment", amendmentNumber: 3 }),
      snap({ key: "k-a2", name: "Amendment 0002.pdf", documentClass: "amendment", amendmentNumber: 2 }),
    ];
    expect(documentChanges([], after).newAmendments.map((a) => a.amendmentNumber)).toEqual([3, 2, 1]);
  });

  it("notices a document that has left the notice", () => {
    const changes = documentChanges([snap({}), snap({ key: "k2", name: "Exhibit A.pdf" })], [snap({})]);
    expect(changes.removed.map((r) => r.name)).toEqual(["Exhibit A.pdf"]);
    expect(changeSummary(changes)).toContain("no longer on the notice");
  });

  it("treats a missing hash as a gap in the record, not as a change", () => {
    /*
     * An unknown hash means the record is incomplete, not that the file
     * moved. Reporting it as a change would make every run after one failed
     * hash look like an amendment landed, and an alert that cries wolf is an
     * alert nobody reads.
     */
    for (const [was, now] of [
      [null, "bbb"],
      ["aaa", null],
      [null, null],
    ] as const) {
      const changes = documentChanges(
        [snap({ contentHash: was })],
        [snap({ contentHash: now })]
      );
      expect(changes.changed, `${was} -> ${now}`).toHaveLength(0);
      expect(changes.unchanged).toBe(1);
    }
  });

  it("keys on the storage path, not the display name", () => {
    // Names are recovered from a Content-Disposition header and can change
    // between runs for the same file. The key cannot.
    const changes = documentChanges(
      [snap({ name: "attachment" })],
      [snap({ name: "Wage Determination.pdf" })]
    );
    expect(changes.quiet).toBe(true);
  });

  it("handles a first run with nothing before it", () => {
    const changes = documentChanges([], [snap({}), snap({ key: "k2" })]);
    expect(changes.added).toHaveLength(2);
    expect(changes.quiet).toBe(false);
  });
});
