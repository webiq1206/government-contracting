/**
 * AI-assisted classification + field extraction from subcontractor reply emails.
 * Detects intent (quote, decline, question, etc.), pulls pricing when present,
 * and captures capability hints. Degrades to regex price spotting when Claude
 * is unavailable (intent stays "other" so we never auto-decline without AI).
 */
import { z } from "zod";
import { completeJson } from "./claude";
import { config } from "../config";

export type ReplyIntent =
  | "quote"
  | "interested"
  | "decline"
  | "cant_fulfill"
  | "question"
  | "other";

export interface ExtractedReply {
  intent: ReplyIntent;
  /** True only when the reply actually contains a price for the work. */
  isQuote: boolean;
  quoteAmount: number | null;
  paymentTerms: string | null;
  notes: string | null;
  companyName: string | null;
  /** Whether they can perform the requested work, when stated. */
  canPerform: boolean | null;
  /** Short summary of capability / decline reason from the reply. */
  capabilityNotes: string | null;
  /** Trades they mention they do (or do not) cover. */
  tradesMentioned: string[];
  /** "ai" when Claude parsed it; "regex" fallback (treat as a hint). */
  method: "ai" | "regex";
}

/** @deprecated Prefer ExtractedReply; kept for callers that still import ExtractedQuote. */
export type ExtractedQuote = ExtractedReply;

const ReplySchema = z.object({
  intent: z.enum([
    "quote",
    "interested",
    "decline",
    "cant_fulfill",
    "question",
    "other",
  ]),
  is_quote: z.boolean(),
  quote_amount: z.number().nullable(),
  payment_terms: z.string().nullable(),
  notes: z.string().nullable(),
  company_name: z.string().nullable(),
  can_perform: z.boolean().nullable(),
  capability_notes: z.string().nullable(),
  trades_mentioned: z.array(z.string()).nullable(),
});

/** Largest plausible dollar figure in the text, or null. */
export function regexPrice(text: string): number | null {
  const matches = [...text.matchAll(/\$\s?([\d][\d,]*(?:\.\d{1,2})?)/g)]
    .map((m) => Number(m[1].replace(/,/g, "")))
    .filter((n) => Number.isFinite(n) && n >= 100 && n <= 100_000_000);
  return matches.length ? Math.max(...matches) : null;
}

function emptyRegexResult(price: number | null): ExtractedReply {
  return {
    intent: "other",
    isQuote: false,
    quoteAmount: price,
    paymentTerms: null,
    notes: null,
    companyName: null,
    canPerform: null,
    capabilityNotes: null,
    tradesMentioned: [],
    method: "regex",
  };
}

export async function extractReplyFromReply(
  replyText: string,
  context: { opportunityTitle?: string | null; trade?: string | null }
): Promise<ExtractedReply> {
  const text = replyText.slice(0, 8000);
  if (config.claude.enabled) {
    try {
      const { data } = await completeJson(
        [
          "You are reading a subcontractor's email reply to a quote / partnership request",
          context.opportunityTitle ? `for the project "${context.opportunityTitle}"` : "",
          context.trade ? `(trade: ${context.trade})` : "",
          ".",
          "Classify intent and extract structured fields.",
          "Rules:",
          "- intent:",
          "  - quote: they give a price (or clear bid number) for the work",
          "  - interested: they want to proceed / will bid but no price yet",
          "  - decline: they are not interested / pass on this opportunity",
          "  - cant_fulfill: they cannot perform the work (wrong trade, capacity, geography, licensing, etc.)",
          "  - question: they mainly ask clarifying questions",
          "  - other: anything else (acknowledgement, out-of-office, unclear)",
          "- is_quote is true ONLY if the reply states a price for the work itself (not fees, not example figures, not questions about price).",
          "- quote_amount: total price in whole US dollars (never cents). If they give a range, use the midpoint. Null when no price.",
          "- payment_terms: any stated terms (e.g. 'net 30', '50% mobilization'), else null.",
          "- notes: a one-to-two sentence summary of conditions, exclusions, or caveats they mention, else null.",
          "- company_name: the company name from their signature if present, else null.",
          "- can_perform: true/false when they clearly say they can or cannot do the work; else null.",
          "- capability_notes: short summary of what they can/cannot do and why (especially for decline / cant_fulfill), else null.",
          "- trades_mentioned: list of trades they mention covering or not covering; empty array if none.",
          "",
          "Email reply:",
          "---",
          text,
          "---",
        ]
          .filter(Boolean)
          .join("\n"),
        { schema: ReplySchema, injectProfile: false, maxTokens: 768 }
      );
      const amount =
        data.quote_amount != null &&
        Number.isFinite(data.quote_amount) &&
        data.quote_amount > 0 &&
        data.quote_amount <= 100_000_000
          ? Math.round(data.quote_amount)
          : null;
      const intent = data.intent;
      const canPerform =
        intent === "decline" || intent === "cant_fulfill"
          ? false
          : data.can_perform;
      return {
        intent,
        isQuote: data.is_quote && amount != null,
        quoteAmount: amount,
        paymentTerms: data.payment_terms,
        notes: data.notes,
        companyName: data.company_name,
        canPerform,
        capabilityNotes: data.capability_notes,
        tradesMentioned: (data.trades_mentioned ?? [])
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 12),
        method: "ai",
      };
    } catch {
      // Fall through to regex; extraction must never break reply handling.
    }
  }
  return emptyRegexResult(regexPrice(text));
}

/** Back-compat alias used by older call sites / tests. */
export const extractQuoteFromReply = extractReplyFromReply;
