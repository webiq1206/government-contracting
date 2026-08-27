import { describe, expect, it } from "vitest";
import { buildOpportunityBrief } from "../lib/domain/opportunity-brief";
import type { ComplianceRequirement } from "../lib/types";

/**
 * A requirement nobody can check is a requirement nobody should trust.
 *
 * The extraction reads a two-hundred-page specification and produces a list of
 * things the bid must contain. Until now the only provenance on that list was
 * a sentence the model wrote ("Section L.3"), which tells an operator the
 * requirement exists and gives them no way at all to confirm it. Checking it
 * meant opening the file and starting to look.
 *
 * These cover the half of that which is pure: what the brief carries through
 * to the screen. The resolution itself, including what happens when a model
 * cites a document that does not exist, is in document-inventory.test.ts.
 */

const req = (over: Partial<ComplianceRequirement>): ComplianceRequirement => ({
  id: "sf1449",
  title: "Signed SF-1449 offer form",
  category: "form",
  mandatory: true,
  source: "Section L.3",
  signature_required: true,
  satisfied_by: "operator_signature",
  ...over,
});

function requirementsOf(matrix: ComplianceRequirement[]) {
  return buildOpportunityBrief({ complianceMatrix: matrix }).requirements;
}

describe("carrying a citation through to the screen", () => {
  it("keeps the document and page the analysis resolved", () => {
    const [r] = requirementsOf([
      req({ source_document_id: "doc-1", source_document: "PWS.pdf", source_page: 44 }),
    ]);
    expect(r.sourceDocumentId).toBe("doc-1");
    expect(r.sourceDocumentName).toBe("PWS.pdf");
    expect(r.sourcePage).toBe(44);
  });

  it("keeps the document when there is no page", () => {
    // A resolved document with no page is still a link worth having: one file
    // to open instead of the whole package.
    const [r] = requirementsOf([req({ source_document_id: "doc-1", source_document: "PWS.pdf" })]);
    expect(r.sourceDocumentId).toBe("doc-1");
    expect(r.sourcePage).toBeUndefined();
  });

  it("carries no anchor when the analysis could not resolve one", () => {
    /*
     * This is the case that must not be papered over. A requirement with no
     * resolved source keeps its stated location and gains nothing else: no
     * document id means the screen shows no link, rather than a link that
     * opens on the wrong file.
     */
    const [r] = requirementsOf([req({ source: "Section L.3" })]);
    expect(r.source).toBe("Section L.3");
    expect(r.sourceDocumentId).toBeUndefined();
    expect(r.sourceDocumentName).toBeUndefined();
    expect(r.sourcePage).toBeUndefined();
  });

  it("does not invent a page from a non-numeric value", () => {
    const [r] = requirementsOf([
      req({
        source_document_id: "doc-1",
        source_page: "forty-four" as unknown as number,
      }),
    ]);
    expect(r.sourcePage).toBeUndefined();
  });

  it("leaves a requirement with neither source nor anchor alone", () => {
    const [r] = requirementsOf([req({ source: "" })]);
    expect(r.source).toBeUndefined();
    expect(r.sourceDocumentId).toBeUndefined();
  });
});
