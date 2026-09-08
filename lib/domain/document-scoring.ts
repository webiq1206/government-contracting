/**
 * Whether scoring may make a final pursue decision from the solicitation as
 * it exists now. Pure so queue routing can be tested without a database or an
 * AI call.
 */
export type DocumentScoringNext = "not_required" | "analyze" | "blocked" | "ready";

export interface DocumentScoringReadiness {
  documentsRequired: boolean;
  analysisComplete: boolean;
  next: DocumentScoringNext;
}

export function documentScoringReadiness(input: {
  sourceAttachmentCount: number;
  activeDocumentCount: number;
  hasAnalysis: boolean;
  analysisInputHash?: string | null;
  briefSource?: string | null;
  completenessOk?: boolean | null;
}): DocumentScoringReadiness {
  const documentsRequired = input.sourceAttachmentCount > 0 || input.activeDocumentCount > 0;
  const analysisComplete =
    Boolean(input.analysisInputHash) &&
    input.briefSource === "model" &&
    input.completenessOk === true;

  if (!documentsRequired) {
    return {
      documentsRequired,
      analysisComplete,
      next: analysisComplete ? "ready" : "not_required",
    };
  }
  if (!input.hasAnalysis || !input.analysisInputHash) {
    return { documentsRequired, analysisComplete, next: "analyze" };
  }
  if (!analysisComplete) {
    return { documentsRequired, analysisComplete, next: "blocked" };
  }
  return { documentsRequired, analysisComplete, next: "ready" };
}
