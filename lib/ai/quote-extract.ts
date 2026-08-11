/**
 * Compatibility shim. Prefer lib/ai/reply-extract.ts for new code.
 * Re-exports reply extraction (intent + quote + capabilities) under the
 * historical quote-extract names.
 */
export {
  regexPrice,
  extractReplyFromReply,
  extractQuoteFromReply,
  type ExtractedReply,
  type ExtractedQuote,
  type ReplyIntent,
} from "./reply-extract";
