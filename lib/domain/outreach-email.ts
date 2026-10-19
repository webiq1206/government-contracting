/**
 * Recipient-facing outreach email extras: project details, attachment list,
 * and guards so internal failures never leak into subcontractor copy.
 */
import { isPlaceholderScope } from "./solicitation-completeness";
import { documentItems } from "./outreach-sections";
import type { BriefSection } from "./outreach-brief";
import { LETTER_RULE, LETTER_SOFT } from "./outreach-letter";

const INTERNAL_FAILURE_RE =
  /\b(could not|couldn't|unable to|failed to|fail to|too thin|HTTP \d{3}|not extractable|no extractable text|too large to parse|could not fetch|could not collect|failed to collect)\b/i;

export function lineLooksLikeInternalFailure(text: string): boolean {
  return INTERNAL_FAILURE_RE.test(text);
}

/** Drop lines that mention internal fetch/extract/attach failures. */
export function scrubInternalFailureCopy(text: string): string {
  return text
    .split(/\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() === "" || !INTERNAL_FAILURE_RE.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function shouldHoldMissingDocs(
  expected: boolean,
  fileCount: number,
  linkCount: number
): boolean {
  return expected && fileCount === 0 && linkCount === 0;
}

export function opportunityExpectsDocuments(
  storedDocCount: number,
  attachmentsJson: unknown
): boolean {
  if (storedDocCount > 0) return true;
  if (!Array.isArray(attachmentsJson)) return false;
  return attachmentsJson.some((a) => {
    if (!a || typeof a !== "object") return false;
    const row = a as { url?: unknown; storage_path?: unknown };
    return Boolean(row.url || row.storage_path);
  });
}

function escapeHtml(plain: string): string {
  return plain
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export interface OutreachDetailsInput {
  title?: string | null;
  solicitationNumber?: string | null;
  agency?: string | null;
  deadlineLabel?: string | null;
  trade?: string | null;
  attachedNames: string[];
  links: { name: string; url: string }[];
}

export interface OutreachDetailsBlock {
  plain: string;
  html: string;
}

/**
 * Project facts + document list appended after the template body.
 * Never includes error, hold, or "could not attach" language.
 */
export function buildOutreachDetailsBlock(
  input: OutreachDetailsInput
): OutreachDetailsBlock {
  const facts = [
    input.title ? `Project: ${input.title}` : "",
    input.solicitationNumber ? `Solicitation #: ${input.solicitationNumber}` : "",
    input.agency ? `Agency: ${input.agency}` : "",
    input.deadlineLabel ? `Bid deadline: ${input.deadlineLabel}` : "",
    input.trade ? `Trade: ${input.trade}` : "",
  ].filter(Boolean);

  const attached = input.attachedNames.filter(Boolean);
  const links = input.links.filter((l) => l.name && l.url);

  /*
   * The attachments are not listed by name. The recipient's mail client
   * already shows them, they are selected and renamed for this recipient
   * before they get here, and an email that inventories its own attachments
   * reads like a manifest. One sentence says what the attachments are FOR;
   * documents too large to attach keep their link, because a link is the
   * only way the recipient can know those exist.
   */
  const docLines = documentItems(attached.length, links);

  const plainParts: string[] = [];
  if (facts.length) plainParts.push(facts.join("\n"));
  if (docLines.length) {
    plainParts.push(`Documents:\n${docLines.map((l) => `- ${l}`).join("\n")}`);
  }

  const htmlBits: string[] = [];
  if (facts.length) {
    htmlBits.push(
      `<p style="margin:0 0 8px">${facts.map(escapeHtml).join("<br/>")}</p>`
    );
  }
  if (docLines.length) {
    htmlBits.push(
      `<p style="margin:8px 0 4px"><strong>Documents</strong></p>` +
        `<ul style="margin:0 0 8px;padding-left:20px">${docLines
          .map(
            (l) =>
              `<li>${escapeHtml(l).replace(
                /(https?:\/\/[^\s<]+)/g,
                (url) => `<a href="${url}">${url}</a>`
              )}</li>`
          )
          .join("")}</ul>`
    );
  }

  if (plainParts.length === 0) return { plain: "", html: "" };

  return {
    plain: `\n\n${plainParts.join("\n\n")}`,
    html:
      `<div style="border-top:1px solid ${LETTER_RULE};margin-top:18px;padding-top:12px">` +
      htmlBits.join("") +
      `</div>`,
  };
}

export function scopeTooThinAfterScrub(scope: string): boolean {
  return isPlaceholderScope(scope) || scope.trim().length < 60;
}

// ---------------------------------------------------------------------------
// Structured brief rendering
// ---------------------------------------------------------------------------

/**
 * Render the brief as titled sections of bullets, in both plain text and HTML.
 *
 * Replaces the old facts-and-file-list block. That one carried five colon
 * lines and the attachments; everything else about the job was upstream in a
 * single paragraph. Sections with headings mean a subcontractor can find the
 * scope, the date or the deliverables without reading the rest.
 */
export function renderOutreachBrief(sections: BriefSection[]): OutreachDetailsBlock {
  const usable = sections.filter((s) => s.items.filter(Boolean).length > 0);
  if (usable.length === 0) return { plain: "", html: "" };

  const plain = usable
    .map((s) => `${s.heading.toUpperCase()}\n${s.items.map((i) => `- ${i}`).join("\n")}`)
    .join("\n\n");

  const html = usable
    .map(
      (s) =>
        `<p style="margin:16px 0 6px;font-size:15px;font-weight:700">${escapeHtml(s.heading)}</p>` +
        `<ul style="margin:0;padding-left:22px">${s.items
          .map((i) => `<li style="margin:0 0 4px">${linkify(escapeHtml(i))}</li>`)
          .join("")}</ul>`
    )
    .join("");

  /*
   * The brief sits under the signature, like an enclosure under a letter, so
   * it is set off with a rule and its own label. Neutral colours: this is the
   * customer's email, not a BrostCo page.
   */
  return {
    plain: `\n\n${"-".repeat(40)}\nPROJECT DETAILS\n\n${plain}`,
    html:
      `<div style="border-top:1px solid ${LETTER_RULE};margin-top:22px;padding-top:6px">` +
      `<p style="margin:10px 0 0;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${LETTER_SOFT}">Project details</p>` +
      html +
      `</div>`,
  };
}

/** Make a bare URL in a document line clickable, without touching the rest. */
function linkify(escaped: string): string {
  return escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) => `<a href="${url}">${url}</a>`
  );
}
