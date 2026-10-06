/** Sources Sought history is not an active bid workflow. */
export const RESEARCH_NOTICE_READ_ONLY =
  "Sources Sought is market research, so bid workflow changes are unavailable. Its saved history is preserved.";

/** The notice-specific responder drafts a capability response; it never sends. */
export function researchNoticeJobProblem(sourcesSought: boolean | undefined, agent: string): string | null {
  return sourcesSought && agent !== "sources-sought-responder" ? RESEARCH_NOTICE_READ_ONLY : null;
}
