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

function escapeHtml(plain: string): string {
  return plain
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function applyInlineMarkup(escaped: string): string {
  // Highlight then bold. Markers are ASCII so they survive HTML escaping.
  return escaped
    .replace(
      /==([^=\n]+)==/g,
      '<span style="background-color:#FFF3CD;padding:0 2px">$1</span>'
    )
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
}

/**
 * Convert a plain-text template body to simple HTML for outbound email.
 *
 * Supports:
 * - `**bold**`
 * - `==highlight==` (yellow background span for email clients)
 * - consecutive lines starting with `- ` or `* ` as a bullet list
 * - remaining newlines as `<br>`
 *
 * Content is HTML-escaped first so operator-authored markup cannot inject tags.
 */
export function plainToHtml(plain: string): string {
  const lines = plain.replace(/\r\n/g, "\n").split("\n");
  const parts: string[] = [];
  let listBuf: string[] = [];

  function flushList() {
    if (listBuf.length === 0) return;
    const items = listBuf
      .map((item) => `<li>${applyInlineMarkup(escapeHtml(item))}</li>`)
      .join("");
    parts.push(`<ul style="margin:8px 0;padding-left:20px">${items}</ul>`);
    listBuf = [];
  }

  for (const line of lines) {
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      listBuf.push(bullet[1]);
      continue;
    }
    flushList();
    if (line.length === 0) {
      parts.push("<br>");
    } else {
      parts.push(applyInlineMarkup(escapeHtml(line)));
      parts.push("<br>");
    }
  }
  flushList();

  // Drop a trailing <br> so the email does not end with an extra blank line.
  if (parts.length > 0 && parts[parts.length - 1] === "<br>") {
    parts.pop();
  }
  return parts.join("");
}
