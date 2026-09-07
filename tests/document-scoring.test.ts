import { describe, expect, it } from "vitest";
import { documentScoringReadiness } from "@/lib/domain/document-scoring";

const ready = (over: Record<string, unknown> = {}) =>
  documentScoringReadiness({
    sourceAttachmentCount: 1,
    activeDocumentCount: 0,
    hasAnalysis: true,
    analysisInputHash: "current-hash",
    briefSource: "model",
    completenessOk: true,
    ...over,
  });

describe("document-first scoring readiness", () => {
  it("requires analysis when the notice links a source document", () => {
    expect(
      ready({ hasAnalysis: false, analysisInputHash: null, briefSource: null, completenessOk: null })
    ).toMatchObject({ documentsRequired: true, analysisComplete: false, next: "analyze" });
  });

  it("also requires analysis for an operator replacement absent from notice links", () => {
    expect(
      ready({
        sourceAttachmentCount: 0,
        activeDocumentCount: 1,
        hasAnalysis: false,
        analysisInputHash: null,
        briefSource: null,
        completenessOk: null,
      })
    ).toMatchObject({ documentsRequired: true, next: "analyze" });
  });

  it("blocks when any document analysis is incomplete", () => {
    expect(ready({ completenessOk: false })).toMatchObject({
      analysisComplete: false,
      next: "blocked",
    });
  });

  it("requires a current analysis fingerprint before treating a brief as complete", () => {
    expect(ready({ analysisInputHash: null })).toMatchObject({
      analysisComplete: false,
      next: "analyze",
    });
  });

  it("allows final scoring only for a model brief with complete coverage", () => {
    expect(ready()).toMatchObject({ analysisComplete: true, next: "ready" });
  });
});
