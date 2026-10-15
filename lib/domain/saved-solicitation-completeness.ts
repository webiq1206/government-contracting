import type { SolicitationAnalysis } from "@/lib/types";

/** Saved evidence, not a new analysis or permission to source/send. */
export interface SavedSolicitationEvidence {
  analysisInputHash?: string | null;
  completeness?: SolicitationAnalysis["completeness"] | null;
  verificationIssues?: readonly string[] | null;
  riskFlags?: readonly string[] | null;
}

const SOURCE_WARNINGS = new Set([
  "awaiting_document_analysis", "incomplete_solicitation", "incomplete_documentation",
  "missing_attachments", "attachments_inaccessible", "unopened_archives",
  "documents_not_read", "documents_partly_read", "unreadable_documents", "unsupported_documents",
  "unverified_analysis", "unverified_scope", "unverified_value", "unverified_set_aside",
  "missing_deadline", "outreach_scope_too_thin", "outreach_docs_missing",
]);

export function assessSavedSolicitationCompleteness(evidence?: SavedSolicitationEvidence) {
  const snapshot = evidence?.completeness;
  if (!evidence?.analysisInputHash?.trim()) {
    return { complete: false, reason: "The saved analysis has not been confirmed against the current source documents." };
  }
  if (!snapshot || !Array.isArray(snapshot.missing)) {
    return { complete: false, reason: "No complete saved source-check result is available for this analysis." };
  }
  if (snapshot.ok !== true || snapshot.missing.some(item => item.critical)) {
    return { complete: false, reason: "The saved completeness check has unresolved requirements." };
  }
  if (evidence.verificationIssues?.length) {
    return { complete: false, reason: "Source-verification issues remain unresolved." };
  }
  if (evidence.riskFlags?.some(flag => SOURCE_WARNINGS.has(flag))) {
    return { complete: false, reason: "Source or document warnings still need review before completeness can be confirmed." };
  }
  return { complete: true, reason: "The saved source check passed with no recorded critical gaps or source warnings." };
}
