/**
 * Last line of defence before an email leaves the building.
 *
 * Every outbound send funnels through `sendOutreachEmail`, which calls this
 * first. If the rendered copy still carries an unresolved token, a redaction
 * marker, or the punctuation residue of a failed substitution, the send is
 * refused and the operator is told — an email that is never sent is recoverable,
 * one that reaches a subcontractor is not.
 */
import { OMISSION } from "./text-repair";

export interface EmailSafetyIssue {
  /** Short machine-readable category. */
  kind: string;
  /** Operator-facing explanation naming what was found and where. */
  detail: string;
}

/** `{{phone}}` never substituted. */
const UNRESOLVED_TOKEN_RE = /\{\{\s*\w+\s*\}\}/;

/**
 * A bracketed stand-in for content we could not include. Matched narrowly by
 * keyword rather than "any bracketed capitals" so a deliberate subject prefix
 * such as the editor's "[TEST]" is not mistaken for a defect.
 */
const PLACEHOLDER_MARKER_RE =
  /\[[^\]\n]*\b(?:REDACTED|PLACEHOLDER|TODO|TBD|UNKNOWN|MISSING|NOT SET|NOT AVAILABLE|N\/A)\b[^\]\n]*\]/i;

/** Whitespace before punctuation: the signature of "call me at ." */
const DANGLING_PUNCTUATION_RE = /\s[,;:!?](?:\s|$)|\s\.(?!\.)(?:\s|$)/;

/** "()" or "( )" left where a parenthetical value used to be. */
const EMPTY_PARENS_RE = /\(\s*\)/;

/** "A |  | B" — a list field that rendered to nothing. */
const EMPTY_LIST_FIELD_RE = /\|\s*\||,\s*,/;

const CHECKS: { kind: string; re: RegExp; describe: string }[] = [
  {
    kind: "unresolved_token",
    re: UNRESOLVED_TOKEN_RE,
    describe: "an unfilled template field",
  },
  {
    kind: "placeholder_marker",
    re: PLACEHOLDER_MARKER_RE,
    describe: "a placeholder standing in for missing content",
  },
  {
    kind: "sentinel",
    re: new RegExp(OMISSION),
    describe: "an internal marker that should have been removed",
  },
  {
    kind: "dangling_punctuation",
    re: DANGLING_PUNCTUATION_RE,
    describe: "a sentence with a gap in it (stray space before punctuation)",
  },
  {
    kind: "empty_parens",
    re: EMPTY_PARENS_RE,
    describe: "an empty pair of parentheses",
  },
  {
    kind: "empty_list_field",
    re: EMPTY_LIST_FIELD_RE,
    describe: "a blank field between separators",
  },
];

/** Strip tags and decode the few entities we emit, so HTML is checked as prose. */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|ul|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

/**
 * Inspect a rendered email. Returns every problem found; an empty array means
 * the email is safe to send.
 */
export function findEmailSafetyIssues(input: {
  subject?: string | null;
  text?: string | null;
  html?: string | null;
}): EmailSafetyIssue[] {
  const issues: EmailSafetyIssue[] = [];

  // Emptiness is the boundary case of silent removal: a template made entirely
  // of unavailable tokens, or one whose every sentence gets dropped, renders to
  // "". That is not "nothing was wrong" — it is a blank email. The rule is that
  // an email either says something correctly or is not sent at all.
  //
  // A surface is only judged when the caller actually supplied that key, so
  // checking a body on its own does not report a missing subject.
  const subjectSupplied = "subject" in input;
  const bodySupplied = "text" in input || "html" in input;

  const readableBody = [input.text ?? "", input.html ? htmlToText(input.html) : ""].join("\n");

  if (subjectSupplied && !/\S/.test(input.subject ?? "")) {
    issues.push({
      kind: "empty_subject",
      detail: "The subject line is empty.",
    });
  }
  if (bodySupplied && !/[A-Za-z0-9]/.test(readableBody)) {
    issues.push({
      kind: "empty_body",
      detail: "The body is empty — there would be nothing for the recipient to read.",
    });
  }

  const surfaces: { label: string; content: string }[] = [];
  if (input.subject) surfaces.push({ label: "subject", content: input.subject });
  if (input.text) surfaces.push({ label: "body", content: input.text });
  if (input.html) surfaces.push({ label: "body", content: htmlToText(input.html) });

  const seen = new Set<string>();

  for (const surface of surfaces) {
    for (const check of CHECKS) {
      const match = surface.content.match(check.re);
      if (!match) continue;
      const dedupeKey = `${surface.label}:${check.kind}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      issues.push({
        kind: check.kind,
        detail: `The ${surface.label} contains ${check.describe}.`,
      });
    }
  }
  return issues;
}

/** One operator-facing sentence explaining why a send was refused. */
export function describeEmailSafetyIssues(issues: EmailSafetyIssue[]): string {
  const details = issues.map((i) => i.detail).join(" ");
  return `Email held before sending because it would have looked broken to the recipient. ${details}`;
}
