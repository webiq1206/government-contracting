/**
 * Shared template-rendering utilities used by both the initial outreach agent
 * (lib/agents/outreach.ts) and the 48-hour follow-up agent
 * (lib/agents/maintenance.ts) so both send paths go through identical logic.
 */

/**
 * Simple {{var}} replacement. Unknown tokens render as empty string so a
 * misconfigured template never leaks raw placeholders to a subcontractor.
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) =>
    key in vars ? vars[key] : ""
  );
}

/**
 * Format an ISO / date string for human-readable use in template bodies.
 * Falls back to the raw string if it cannot be parsed.
 */
export function formatDeadlineLabel(deadline: string | null): string {
  if (!deadline) return "the stated deadline";
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return deadline;
  return d.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Convert a plain-text template body to simple inline HTML (newline → br).
 * Uses the non-self-closing `<br>` form for broadest email-client compatibility.
 */
export function plainToHtml(plain: string): string {
  return plain.replace(/\n/g, "<br>");
}
