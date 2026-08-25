/**
 * Shared template-rendering utilities used by both the initial outreach agent
 * (lib/agents/outreach.ts) and the 48-hour follow-up agent
 * (lib/agents/maintenance.ts) so both send paths go through identical logic.
 */
import { OMISSION, repairOmissions } from "./text-repair";

/**
 * {{var}} replacement where a missing value removes the sentence that needed it.
 *
 * Rendering an absent token as an empty string leaves a hole in the prose —
 * "You can also call me at ." — which is as damaging as leaking the raw token.
 * An unknown or blank value is masked instead, and the clause or sentence that
 * existed only to introduce it is dropped, so the email either says something
 * correctly or does not say it at all.
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string>
): string {
  let omitted = false;
  const masked = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => {
    const value = key in vars ? vars[key] : "";
    if (typeof value !== "string" || value.trim() === "") {
      omitted = true;
      return OMISSION;
    }
    return value;
  });
  return omitted ? repairOmissions(masked) : masked;
}

/**
 * Format an ISO / date string for human-readable use in template bodies.
 *
 * A timezone is required rather than optional, and the format matches the one
 * the quote deadline uses. Both dates appear in the same list in the generated
 * Project section, and they used to render differently: "August 28, 2026 at
 * 3:00 PM MDT" next to "Sep 4, 2026, 6:00 PM". The second had no zone at all
 * and was rendered in the SERVER's timezone, which in production is UTC, so
 * the bid deadline shown to a subcontractor was wrong by hours and gave no
 * clue that it was.
 *
 * Falls back to the raw string if it cannot be parsed, because an unparseable
 * date that a human wrote is more use to the reader than a blank.
 */
export function formatDeadlineLabel(
  deadline: string | null,
  timeZone = "America/New_York"
): string {
  if (!deadline) return "the stated deadline";
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return deadline;
  const date = d.toLocaleDateString("en-US", {
    timeZone,
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return `${date} at ${time}`;
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
      '<span style="background-color:#FFF3CD;color:#242424;padding:0 2px">$1</span>'
    )
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
}

/**
 * Recover from broken editor markup: keep complete ==phrase== pairs, strip
 * leftover ==, drop a leading "-- " separator, and collapse doubled bullets
 * from wrapping {{questions}} in "- ".
 */
export function normalizeEmailLine(line: string): string {
  const pairs: string[] = [];
  const withPlaceholders = line.replace(/==([^=\n]+)==/g, (_m, inner: string) => {
    const i = pairs.length;
    pairs.push(`==${inner}==`);
    return `\u0000H${i}\u0000`;
  });
  let s = withPlaceholders.replace(/==/g, "");
  s = s.replace(/\u0000H(\d+)\u0000/g, (_m, i: string) => pairs[Number(i)] ?? "");
  s = s.replace(/^(\s*)--\s+/, "$1");
  s = s.replace(/^(\s*)[-*•]\s+[-*•]\s+/, "$1- ");
  return s;
}

const BULLET_RE = /^\s*[-*•]\s+(.*)$/;

/**
 * Convert a plain-text template body to simple HTML for outbound email.
 *
 * Supports:
 * - `**bold**`
 * - `==highlight==` (yellow background span for email clients, same line only)
 * - consecutive lines starting with `- `, `* `, or `• ` as a bullet list
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

  for (const raw of lines) {
    const line = normalizeEmailLine(raw);
    const bullet = line.match(BULLET_RE);
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
