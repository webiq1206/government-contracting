/**
 * How every email to a subcontractor looks.
 *
 * Outreach goes out from the customer's own inbox, as that company, so it is
 * deliberately not wrapped in the BrostCo platform layout: no banner, no
 * logo, no button. A subcontractor should receive what reads like a careful
 * person's business email, because that is what gets a reply, and because
 * heavy marketing-style HTML from a personal mailbox is what spam filters
 * look for. What this guarantees instead is consistency: one readable font
 * and size, real paragraph spacing, a clear project brief, and the same
 * signature on every message the company sends.
 *
 * Pure.
 */
import { plainToHtml } from "./template-render";

const LETTER_ATTR = 'data-outreach-letter="1"';

export const LETTER_FONT = "Arial,Helvetica,sans-serif";
export const LETTER_INK = "#1f2a30";
export const LETTER_SOFT = "#5a6a72";
export const LETTER_RULE = "#d8e0de";

/**
 * Put a body fragment inside the one outer container every outreach email
 * shares. Idempotent: a body that already has it is returned unchanged, so
 * the transport can apply it to everything without double-wrapping.
 */
export function wrapLetter(html: string): string {
  if (!html || html.includes(LETTER_ATTR)) return html;
  if (/^\s*<!doctype html|^\s*<html[\s>]/i.test(html)) return html;
  return `<div ${LETTER_ATTR} style="font-family:${LETTER_FONT};font-size:15px;line-height:1.6;color:${LETTER_INK};max-width:640px">${html}</div>`;
}

export interface SignatureProfile {
  outreach_display_name?: string | null;
  owner_name?: string | null;
  legal_name?: string | null;
  dba?: string | null;
  phone?: string | null;
}

/**
 * The sign-off lines: the person's name, the company, and a phone number when
 * one is on file. Every automatic message to a subcontractor ends with these,
 * so a firm sees the same sender whether it is reading the request, the
 * follow-up, the last call or the thank-you.
 */
export function signatureLines(profile: SignatureProfile | null | undefined, displayName?: string | null): string[] {
  const name = (displayName ?? "").trim() || profile?.outreach_display_name?.trim() || profile?.owner_name?.trim() || "";
  const company = profile?.dba?.trim() || profile?.legal_name?.trim() || "";
  const phone = profile?.phone?.trim() || "";
  return [name, company && company !== name ? company : "", phone].filter(Boolean);
}

/** A complete letter from plain text: the same rendering the templates use. */
export function letterHtml(text: string): string {
  return wrapLetter(plainToHtml(text));
}
