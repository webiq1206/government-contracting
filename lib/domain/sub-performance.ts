/**
 * What can be recorded about how a subcontractor's work went, and how each of
 * those reads on a screen.
 *
 * Split from the service so a browser can render the form without pulling a
 * database driver into the bundle. That is a real constraint rather than
 * tidiness: the component that offers these three choices is a client
 * component, and the module that writes them opens a connection pool.
 *
 * Pure. No imports.
 */

export const PERFORMANCE_KINDS = ["completed", "issue", "cancelled"] as const;
export type PerformanceKind = (typeof PERFORMANCE_KINDS)[number];

export const PERFORMANCE_LABEL: Record<PerformanceKind, string> = {
  completed: "Finished the work",
  issue: "There was a problem",
  cancelled: "Backed out after committing",
};

export const PERFORMANCE_HINT: Record<PerformanceKind, string> = {
  completed: "They did what they said they would.",
  issue: "Something went wrong on the job. Say what, so it can be checked later.",
  cancelled: "They committed and then pulled out. Say when and why.",
};

export function isPerformanceKind(v: unknown): v is PerformanceKind {
  return (PERFORMANCE_KINDS as readonly string[]).includes(String(v));
}
