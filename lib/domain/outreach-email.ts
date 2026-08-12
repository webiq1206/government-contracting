/**
 * Recipient-facing outreach email extras: project details, attachment list,
 * and guards so internal failures never leak into subcontractor copy.
 */
import { isPlaceholderScope } from "./solicitation-completeness";

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

  const plainParts: string[] = [];
  if (facts.length) plainParts.push(facts.join("\n"));
  if (attached.length) {
    plainParts.push(`Attached:\n${attached.map((n) => `- ${n}`).join("\n")}`);
  }
  if (links.length) {
    plainParts.push(
      `Documents:\n${links.map((l) => `- ${l.name}: ${l.url}`).join("\n")}`
    );
  }

  const htmlBits: string[] = [];
  if (facts.length) {
    htmlBits.push(
      `<p style="color:#242424;margin:0 0 8px">${facts.map(escapeHtml).join("<br/>")}</p>`
    );
  }
  if (attached.length) {
    htmlBits.push(
      `<p style="color:#242424;margin:8px 0 4px"><strong>Attached</strong></p>` +
        `<ul style="margin:0 0 8px;padding-left:20px">${attached
          .map((n) => `<li>${escapeHtml(n)}</li>`)
          .join("")}</ul>`
    );
  }
  if (links.length) {
    htmlBits.push(
      `<p style="color:#242424;margin:8px 0 4px"><strong>Documents</strong></p>` +
        `<ul style="margin:0 0 8px;padding-left:20px">${links
          .map(
            (l) =>
              `<li>${escapeHtml(l.name)}: <a href="${escapeHtml(l.url)}">${escapeHtml(l.url)}</a></li>`
          )
          .join("")}</ul>`
    );
  }

  if (plainParts.length === 0) return { plain: "", html: "" };

  return {
    plain: `\n\n${plainParts.join("\n\n")}`,
    html:
      `<div style="border-top:2px solid #B28F5D;margin-top:16px;padding-top:12px">` +
      htmlBits.join("") +
      `</div>`,
  };
}

export function scopeTooThinAfterScrub(scope: string): boolean {
  return isPlaceholderScope(scope) || scope.trim().length < 60;
}
