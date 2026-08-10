/**
 * AI-assisted price extraction from subcontractor reply emails. Reads the full
 * reply text and pulls out a quoted amount plus payment terms/notes so the
 * quote record can be created automatically. Degrades to the regex-based
 * price spotting (largest plausible dollar figure) when Claude is unavailable,
 * flagged low-confidence so downstream treats it as a hint only.
 */
import { z } from "zod";
import { completeJson } from "./claude";
import { config } from "../config";

export interface ExtractedQuote {
  /** True only when the reply actually contains a price for the work. */
  isQuote: boolean;
  quoteAmount: number | null;
  paymentTerms: string | null;
  notes: string | null;
  companyName: string | null;
  /** "ai" when Claude parsed it; "regex" fallback (treat as a hint). */
  method: "ai" | "regex";
}

const QuoteSchema = z.object({
  is_quote: z.boolean(),
  quote_amount: z.number().nullable(),
  payment_terms: z.string().nullable(),
  notes: z.string().nullable(),
  company_name: z.string().nullable(),
});

/** Largest plausible dollar figure in the text, or null. */
export function regexPrice(text: string): number | null {
  const matches = [...text.matchAll(/\$\s?([\d][\d,]*(?:\.\d{1,2})?)/g)]
    .map((m) => Number(m[1].replace(/,/g, "")))
    .filter((n) => Number.isFinite(n) && n >= 100 && n <= 100_000_000);
  return matches.length ? Math.max(...matches) : null;
}

export async function extractQuoteFromReply(
  replyText: string,
  context: { opportunityTitle?: string | null; trade?: string | null }
): Promise<ExtractedQuote> {
  const text = replyText.slice(0, 8000);
  if (config.claude.enabled) {
    try {
      const { data } = await completeJson(
        [
          "You are reading a subcontractor's email reply to a quote request",
          context.opportunityTitle ? `for the project "${context.opportunityTitle}"` : "",
          context.trade ? `(trade: ${context.trade})` : "",
          ".",
          "Extract their pricing if present.",
          "Rules:",
          "- is_quote is true ONLY if the reply states a price for the work itself (not fees, not example figures, not questions about price).",
          "- quote_amount: total price in whole US dollars (never cents). If they give a range, use the midpoint. Null when no price.",
          "- payment_terms: any stated terms (e.g. 'net 30', '50% mobilization'), else null.",
          "- notes: a one-to-two sentence summary of conditions, exclusions, or caveats they mention, else null.",
          "- company_name: the company name from their signature if present, else null.",
          "",
          "Email reply:",
          "---",
          text,
          "---",
        ]
          .filter(Boolean)
          .join("\n"),
        { schema: QuoteSchema, injectProfile: false, maxTokens: 512 }
      );
      const amount =
        data.quote_amount != null &&
        Number.isFinite(data.quote_amount) &&
        data.quote_amount > 0 &&
        data.quote_amount <= 100_000_000
          ? Math.round(data.quote_amount)
          : null;
      return {
        isQuote: data.is_quote && amount != null,
        quoteAmount: amount,
        paymentTerms: data.payment_terms,
        notes: data.notes,
        companyName: data.company_name,
        method: "ai",
      };
    } catch {
      // Fall through to regex, extraction must never break reply handling.
    }
  }
  const price = regexPrice(text);
  return {
    isQuote: false, // regex can't confirm intent; treat as a hint only
    quoteAmount: price,
    paymentTerms: null,
    notes: null,
    companyName: null,
    method: "regex",
  };
}
