/**
 * Safety rules for attributing inbound email replies and deciding when a
 * quote may be auto-saved. Kept as pure functions so the rules are unit-tested
 * independently of the reply poller's I/O.
 */

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
