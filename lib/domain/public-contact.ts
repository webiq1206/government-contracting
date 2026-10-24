/**
 * Public contact form: who receives it, and the tip an inbox search can find.
 *
 * Inbox order is CONTACT_INBOX_EMAIL, then DIGEST_EMAIL_TO, then
 * hello@brostco.com. Delivery goes through system mail. This module only
 * chooses the address and the message.
 */
import { noEmDash } from "../sanitize";

export const CONTACT_TIP_MARKER = "Contact tip";
export const CONTACT_INBOX_FALLBACK = "hello@brostco.com";

const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function oneLine(value: string, max: number): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function inboxAddress(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || /[\r\n]/.test(trimmed) || !EMAIL.test(trimmed)) return null;
  return trimmed;
}

/** First usable inbox: contact override, digest recipient, then the public address. */
export function resolveContactInbox(input: {
  contactInbox?: string | null;
  digestTo?: string | null;
}): string {
  return (
    inboxAddress(input.contactInbox) ??
    inboxAddress(input.digestTo) ??
    CONTACT_INBOX_FALLBACK
  );
}

export interface ContactTip {
  name: string;
  email: string;
  message: string;
  subject: string;
  text: string;
}

export function buildContactTip(input: {
  name: string;
  email: string;
  message: string;
}): ContactTip {
  const name = noEmDash(oneLine(input.name, 120));
  const email = noEmDash(oneLine(input.email, 254).toLowerCase());
  const message = noEmDash(
    input.message
      .replace(/\r\n/g, "\n")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .trim()
      .slice(0, 5000),
  );
  const subject = `${CONTACT_TIP_MARKER}: ${name.slice(0, 80)}`;
  const text = [
    CONTACT_TIP_MARKER,
    "",
    `Name: ${name}`,
    `Email: ${email}`,
    "",
    "Message:",
    message,
  ].join("\n");
  return { name, email, message, subject, text };
}

export type ContactParseResult =
  | { ok: true; honeypot: true }
  | { ok: true; honeypot: false; tip: ContactTip }
  | { ok: false; error: string };

export function parseContactSubmission(raw: {
  name?: unknown;
  email?: unknown;
  message?: unknown;
  company_url?: unknown;
}): ContactParseResult {
  if (typeof raw.company_url === "string" && raw.company_url.trim()) {
    return { ok: true, honeypot: true };
  }
  const name = typeof raw.name === "string" ? raw.name : "";
  const email = typeof raw.email === "string" ? raw.email : "";
  const message = typeof raw.message === "string" ? raw.message : "";
  const tip = buildContactTip({ name, email, message });
  if (tip.name.length < 2) return { ok: false, error: "Enter your name." };
  if (!EMAIL.test(tip.email)) return { ok: false, error: "Enter a valid email address." };
  if (tip.message.length < 2) return { ok: false, error: "Enter a message." };
  return { ok: true, honeypot: false, tip };
}
