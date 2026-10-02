import { inventoryCoverage, type ExtractionState } from "./document-inventory";
import type { AttachmentFetchOutcome, AttachmentFetchStatus } from "./solicitation-completeness";

/** Shared by persisted inventory states and the analyst's activity summary. */
export function extractionStateFor(status: AttachmentFetchStatus, trimmed: boolean): ExtractionState {
  switch (status) {
    case "fetched":
      return trimmed ? "partial" : "extracted";
    case "partial":
      return "partial";
    case "not_read":
    case "archive":
      return "not_read";
    case "no_text":
      return "unreadable";
    case "unsupported":
      return "not_read";
    default:
      return "pending";
  }
}

/** Fitting an error description into a prompt does not mean the file was read. */
export function attachmentReadingCoverage(outcomes: readonly AttachmentFetchOutcome[]) {
  return inventoryCoverage(outcomes.map((outcome, index) => ({
    id: String(index),
    name: outcome.name,
    documentClass: "other" as const,
    disposition: (["failed", "too_large", "no_url", "refused"] as AttachmentFetchStatus[]).includes(outcome.status)
      ? "blocked" as const : "delivered" as const,
    extractionState: extractionStateFor(outcome.status, false),
    excludedReason: null,
  })));
}
