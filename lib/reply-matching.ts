/**
 * Safety rules for attributing inbound email replies and deciding when a
 * quote may be auto-saved or a decline auto-applied. Kept as pure functions so
 * the rules are unit-tested independently of the reply poller's I/O.
 */

import type { ReplyIntent } from "./ai/reply-extract";

/** Normalize an email for comparison (trim, lowercase). */
export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/** True when the reply sender is the same mailbox as the subcontractor on record. */
export function senderMatchesSub(
  fromEmail: string | null | undefined,
  subEmail: string | null | undefined
): boolean {
  const a = normalizeEmail(fromEmail);
  const b = normalizeEmail(subEmail);
  return a !== "" && a === b;
}

/**
 * Consumer mail hosts. Same-domain trust is never applied to these: two
 * gmail.com addresses are not the same company. Exact mailbox or a stored
 * alias is still allowed.
 */
const FREEMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "yahoo.co.jp",
  "ymail.com",
  "rocketmail.com",
  "outlook.com",
  "hotmail.com",
  "hotmail.co.uk",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "aim.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.net",
  "mail.com",
]);

function mailboxOf(email: string | null | undefined): string {
  const normalized = normalizeEmail(email);
  const angled = normalized.match(/<([^>]+)>/)?.[1]?.trim();
  return angled || normalized;
}

/** Host after @, or null when the address is not a mailbox. */
export function mailboxDomain(email: string | null | undefined): string | null {
  const box = mailboxOf(email);
  const at = box.lastIndexOf("@");
  if (at <= 0 || at >= box.length - 1) return null;
  const domain = box.slice(at + 1);
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(domain)) return null;
  return domain;
}

/** True for consumer hosts. Company domains such as bulldogrooter.com are false. */
export function isFreemailAddress(email: string | null | undefined): boolean {
  const domain = mailboxDomain(email);
  if (!domain) return false;
  if (FREEMAIL_DOMAINS.has(domain)) return true;
  return /^(?:gmail|googlemail|yahoo|ymail|rocketmail|hotmail|outlook|live|msn|icloud|aol|aim|protonmail|gmx)\.(?:com|net|org|co\.[a-z]{2}|[a-z]{2})$/.test(domain);
}

export type SenderTrustVia = "exact" | "alias" | "domain";

export interface SenderTrust {
  verified: boolean;
  /** How the sender was accepted. Null when verification failed. */
  via: SenderTrustVia | null;
}

/**
 * Who may speak for the firm on a reply that is already tied to one conversation.
 *
 * Exact mailbox match always counts. On a strong match only, a stored alias
 * counts, and so does any other mailbox on the roster contact's own company
 * domain. Freemail stays exact-only: dispatch@gmail.com is not chris@gmail.com.
 * A weak match never gains domain or alias trust, because the sender address
 * is then the only thing tying the message to a solicitation.
 */
export function senderTrust(input: {
  fromEmail: string | null | undefined;
  subEmail: string | null | undefined;
  strongMatch: boolean;
  aliases?: ReadonlyArray<string | null | undefined> | null;
}): SenderTrust {
  const from = mailboxOf(input.fromEmail);
  const sub = mailboxOf(input.subEmail);
  if (from && sub && from === sub) return { verified: true, via: "exact" };
  if (!input.strongMatch || !from) return { verified: false, via: null };
  const aliases = new Set((input.aliases ?? []).map(mailboxOf).filter(Boolean));
  if (aliases.has(from)) return { verified: true, via: "alias" };
  const fromDomain = mailboxDomain(from);
  const subDomain = mailboxDomain(sub);
  if (!fromDomain || !subDomain || fromDomain !== subDomain) return { verified: false, via: null };
  if (isFreemailAddress(from) || isFreemailAddress(sub)) return { verified: false, via: null };
  return { verified: true, via: "domain" };
}

export interface AutoSaveDecisionInput {
  /** Reply matched the outbound Gmail thread id (reliable correlation). */
  threadMatched: boolean;
  /** Sender mailbox equals the linked subcontractor's email, or the sub was resolved/created from this exact sender. */
  senderVerified: boolean;
  /** AI confirmed the reply is an actual quote. */
  isQuote: boolean;
  /** Extracted amount (dollars), if any. */
  quoteAmount: number | null;
}

/**
 * A quote may be auto-saved only when the reply is BOTH thread-matched and
 * sender-verified, and the AI confirmed a real price. Anything weaker (sender-
 * only fallback match, a different participant replying inside the thread,
 * regex-only price hints) is routed to manual review instead.
 *
 * This answers WHO is speaking, and only that. Whether the reply was
 * understood well enough to act on is decideReply's question, and callers must
 * pass both gates: this function has no view of confidence, self-contradiction,
 * or an attachment nobody could open. It once carried the whole decision, and a
 * quote the model scored 0.2 went onto a bid because the two were never
 * combined.
 */
export function shouldAutoSaveQuote(input: AutoSaveDecisionInput): boolean {
  return (
    input.threadMatched &&
    input.senderVerified &&
    input.isQuote &&
    input.quoteAmount != null &&
    input.quoteAmount > 0
  );
}

/** True when AI classified the reply as a hard pass / cannot fulfill. */
export function isDeclineIntent(intent: ReplyIntent | null | undefined): boolean {
  return intent === "decline" || intent === "cant_fulfill";
}

export interface AutoDeclineDecisionInput {
  /** Sender mailbox equals the linked subcontractor's email (or was resolved from it). */
  senderVerified: boolean;
  intent: ReplyIntent | null | undefined;
}

/**
 * Confirms the sender and decline intent. The caller must additionally require
 * strong conversation correlation before closing a solicitation or sending a
 * thank-you: a sender address alone identifies a firm, not which bid they mean.
 *
 * Same division as above: this is ownership, not comprehension. Closing a sub
 * out also emails them, so the caller pairs it with decideReply.
 */
export function shouldAutoDecline(input: AutoDeclineDecisionInput): boolean {
  return input.senderVerified && isDeclineIntent(input.intent);
}
