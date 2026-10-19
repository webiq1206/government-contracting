/**
 * Every email the platform sends as itself, in one layout.
 *
 * Password resets, invitations, trial and billing notices, the weekly KPI
 * and learning reports, reply notifications and operator alerts all go
 * through systemMail.send. That choke point renders through here, so a new
 * email cannot ship looking like a bare text dump: a caller that passes only
 * text gets the branded shell with its paragraphs, lists and links laid out;
 * a caller that passes an HTML fragment gets that fragment inside the same
 * shell; a caller that already built a complete shell is left alone.
 *
 * Pure. The app URL is passed in so this can be rendered in tests and in
 * the preview script without configuration.
 */
import {
  absoluteUrl,
  emailButton,
  emailList,
  emailLinkedText,
  emailShell,
  emailText,
  escapeHtml,
} from "./email-shell";

export const SYSTEM_BRAND_NAME = "BrostCo";
export const SYSTEM_LOGO_PATH = "/brand/wordmark-light.png";

export interface SystemEmailInput {
  /** Heading in the header band. Usually the subject without the brand prefix. */
  title: string;
  /** Line under the heading, and the inbox preview text. */
  preheader?: string;
  /** Small uppercase line above the heading, such as "Weekly report". */
  eyebrow?: string;
  /** Rendered body fragments, in order. */
  blocks: string[];
  /** One primary action, rendered as a button after the body. */
  action?: { label: string; href: string } | null;
  /** Extra footer lines (plain text). */
  footer?: string[];
  /** Hide the visible line under the heading when the body opens with it. */
  hidePreheader?: boolean;
}

export function systemFooter(extra: string[] = []): string[] {
  return extra.map((line) => escapeHtml(line));
}

export function renderSystemEmail(appUrl: string, input: SystemEmailInput): string {
  const body = [
    ...input.blocks.filter(Boolean),
    input.action ? emailButton(input.action.label, absoluteUrl(appUrl, input.action.href) ?? input.action.href) : "",
  ].join("");
  return emailShell({
    title: input.title,
    preheader: input.preheader,
    eyebrow: input.eyebrow,
    body,
    footer: systemFooter(input.footer ?? []),
    brandName: SYSTEM_BRAND_NAME,
    brandHref: siteLabel(appUrl) ? appUrl.replace(/\/+$/, "") : null,
    logoUrl: absoluteUrl(appUrl, SYSTEM_LOGO_PATH),
    showPreheader: !input.hidePreheader,
  });
}

/** True when the HTML is already a complete document, not a fragment. */
export function isCompleteEmailDocument(html: string): boolean {
  return /^\s*<!doctype html/i.test(html) || /^\s*<html[\s>]/i.test(html);
}

/** The heading for a subject line: brand prefixes are already in the header. */
export function titleFromSubject(subject: string): string {
  const stripped = subject
    .replace(/^\s*(?:brost\s?co|brostco)\s*[:,|-]?\s*/i, "")
    .trim();
  const title = stripped || subject.trim() || SYSTEM_BRAND_NAME;
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/**
 * Lay out plain text the way it was written.
 *
 * Blank lines separate paragraphs. Consecutive lines starting with "-", "*"
 * or "•" become one list. A paragraph whose only content is a URL becomes a
 * button when it is the first such link (labelled from the sentence before
 * it), and a plain link after that. Other bare URLs become links in place.
 * A closing sign-off of the brand name alone is dropped, because the footer
 * already says who sent it.
 */
export function plainTextToSystemBlocks(text: string): {
  blocks: string[];
  action: { label: string; href: string } | null;
} {
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  while (paragraphs.length && /^(?:the\s+)?(?:brost\s?co|brostco)(?:\s+team)?\.?$/i.test(paragraphs[paragraphs.length - 1])) {
    paragraphs.pop();
  }

  const blocks: string[] = [];
  let action: { label: string; href: string } | null = null;
  let previous = "";
  for (const paragraph of paragraphs) {
    const lines = paragraph.split("\n").map((l) => l.trim()).filter(Boolean);
    const urlOnly = /^https?:\/\/\S+$/.test(paragraph);
    if (urlOnly && !action) {
      action = { label: buttonLabel(previous), href: paragraph };
      previous = paragraph;
      continue;
    }
    const bulletLines = lines.filter((l) => /^[-*•]\s+/.test(l));
    if (bulletLines.length === lines.length) {
      blocks.push(emailList(lines.map((l) => l.replace(/^[-*•]\s+/, ""))));
    } else if (bulletLines.length > 0 && !/^[-*•]\s+/.test(lines[0])) {
      // A lead-in line followed by a list: "Items that need attention:" then bullets.
      const lead = lines.filter((l) => !/^[-*•]\s+/.test(l));
      blocks.push(emailLinkedText(lead.join(" ")));
      blocks.push(emailList(bulletLines.map((l) => l.replace(/^[-*•]\s+/, ""))));
    } else if (lines.length > 1 && lines.slice(1).every((l) => /^https?:\/\/\S+$/.test(l)) && !action) {
      // "Set up your account here:" followed on the next line by the link.
      blocks.push(emailText(lines[0]));
      action = { label: buttonLabel(lines[0]), href: lines[1] };
    } else {
      for (const line of lines.length > 1 && lines.every((l) => l.length < 120) ? lines : [lines.join(" ")]) {
        blocks.push(emailLinkedText(line));
      }
    }
    previous = paragraph;
  }
  return { blocks, action };
}

/**
 * A button label from the sentence that introduced the link: "Choose a
 * plan: https://..." reads as "Choose a plan". Falls back to "Open BrostCo".
 */
export function buttonLabel(lead: string): string {
  const firstLine = lead.split("\n").pop() ?? "";
  const cleaned = firstLine
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/\s+here\b/i, "")
    .replace(/\s+using this link\b/i, "")
    .replace(/[:.\s]+$/, "")
    .trim();
  if (!cleaned || cleaned.length > 40) return `Open ${SYSTEM_BRAND_NAME}`;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** Inline a lone "Label: https://..." line as button + label, for copy that ends that way. */
export function splitTrailingLink(text: string): { text: string; link: { label: string; href: string } | null } {
  const match = text.match(/(?:^|\n)([^\n:]{2,40}):\s*(https?:\/\/\S+)\s*(?=\n|$)/);
  if (!match) return { text, link: null };
  return {
    text: text.replace(match[0], match[0].startsWith("\n") ? "\n" : ""),
    link: { label: match[1].trim(), href: match[2] },
  };
}

function siteLabel(appUrl: string): string {
  try {
    return new URL(appUrl).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Render any system email from what its caller supplied. See the file header.
 */
export function composeSystemEmailHtml(
  appUrl: string,
  input: { subject: string; text: string; html?: string | null }
): string {
  if (input.html && isCompleteEmailDocument(input.html)) return input.html;
  const title = titleFromSubject(input.subject);
  if (input.html) {
    return renderSystemEmail(appUrl, { title, blocks: [input.html] });
  }
  const { text, link } = splitTrailingLink(input.text);
  const laid = plainTextToSystemBlocks(text);
  return renderSystemEmail(appUrl, {
    title,
    blocks: laid.blocks,
    action: laid.action ?? link,
  });
}
