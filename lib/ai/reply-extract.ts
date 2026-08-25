/**
 * AI-assisted classification + field extraction from subcontractor reply emails.
 * Detects intent (quote, decline, question, etc.), pulls pricing when present,
 * and captures capability hints. Degrades to regex price spotting when Claude
 * is unavailable (intent stays "other" so we never auto-decline without AI).
 */
import { z } from "zod";
import { completeJson, claudeEnabled } from "./claude";
import { config } from "../config";

export type ReplyIntent =
  | "quote"
  | "interested"
  | "decline"
  | "unavailable"
  | "cant_fulfill"
  | "question"
  | "other"
  /* --- Added because each was previously flattened into something wrong. --- */
  /** They can do part of the scope, but not all of it. */
  | "partial_scope"
  /** Interested, but need longer than we gave them. */
  | "needs_time"
  /** We wrote to the wrong person at the right company. */
  | "wrong_contact"
  /** They pointed us at someone else, here or elsewhere. */
  | "referred"
  /** They do not work in this trade at all. */
  | "does_not_perform_trade";

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
  /** What work they are pricing, in their own terms. */
  scopeSummary: string | null;
  /** Cost split when they break it out; null when they quote a single number. */
  laborCost: number | null;
  materialCost: number | null;
  /** Work they explicitly exclude from the price. */
  exclusions: string[];
  /** Conditions attached to the price (permits by others, escalation, etc.). */
  qualifications: string[];
  /** Lead time before they can start, in days. */
  leadTimeDays: number | null;
  /** Free-text availability window when a date is not extractable. */
  availabilityNotes: string | null;
  /** How long they say the price holds. */
  quoteValidUntil: string | null;
  /** True when they call it firm, false when they call it an estimate. */
  priceIsFirm: boolean | null;
  /** Whether tax is inside the number, when they say. */
  taxesIncluded: boolean | null;
  /** Optional prices they offer for doing it differently. */
  alternates: string[];
  /** The soonest they say they could start, in their own words. */
  earliestStart: string | null;
  /**
   * Whether the price covers everything we asked for.
   *
   * The field that stops a bid being assembled from a hole: a sub who quotes
   * two of the three buildings, and whose email reads like a complete quote,
   * used to be recorded as fully covering the trade.
   */
  coversFullScope: boolean | null;
  /** The part they are NOT covering, in their words. */
  uncoveredScope: string | null;
  /** Name, company or email they pointed us at. */
  referredTo: string | null;
  /**
   * Bid fields a human would still have to chase. Drives the automatic
   * clarification email and blocks the workflow from advancing early.
   */
  missingFields: string[];
  /**
   * Statements that contradict each other or the solicitation. Never resolved
   * automatically: a wrong guess here puts a bad number in a bid.
   */
  conflicts: string[];
  /** 0 to 1. Low confidence routes to a human instead of acting. */
  confidence: number;
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
    "unavailable",
    "cant_fulfill",
    "question",
    "other",
    "partial_scope",
    "needs_time",
    "wrong_contact",
    "referred",
    "does_not_perform_trade",
  ]),
  is_quote: z.boolean(),
  quote_amount: z.number().nullable(),
  payment_terms: z.string().nullable(),
  notes: z.string().nullable(),
  company_name: z.string().nullable(),
  can_perform: z.boolean().nullable(),
  capability_notes: z.string().nullable(),
  trades_mentioned: z.array(z.string()).nullable(),
  scope_summary: z.string().nullable(),
  labor_cost: z.number().nullable(),
  material_cost: z.number().nullable(),
  exclusions: z.array(z.string()).nullable(),
  qualifications: z.array(z.string()).nullable(),
  lead_time_days: z.number().nullable(),
  availability_notes: z.string().nullable(),
  quote_valid_until: z.string().nullable(),
  price_is_firm: z.boolean().nullable(),
  taxes_included: z.boolean().nullable(),
  alternates: z.array(z.string()).nullable(),
  earliest_start: z.string().nullable(),
  covers_full_scope: z.boolean().nullable(),
  uncovered_scope: z.string().nullable(),
  referred_to: z.string().nullable(),
  missing_fields: z.array(z.string()).nullable(),
  conflicts: z.array(z.string()).nullable(),
  confidence: z.number(),
});

/** Accept a money figure only in a range a real subcontract price can occupy. */
function sanePositive(n: number | null): number | null {
  return n != null && Number.isFinite(n) && n > 0 && n <= 100_000_000
    ? Math.round(n)
    : null;
}

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
    scopeSummary: null,
    laborCost: null,
    materialCost: null,
    exclusions: [],
    qualifications: [],
    leadTimeDays: null,
    availabilityNotes: null,
    quoteValidUntil: null,
    priceIsFirm: null,
    taxesIncluded: null,
    alternates: [],
    earliestStart: null,
    coversFullScope: null,
    uncoveredScope: null,
    referredTo: null,
    missingFields: [],
    conflicts: [],
    // A regex hit is a number in some text, not an understood reply. Zero
    // confidence keeps it out of every automatic decision downstream.
    confidence: 0,
    method: "regex",
  };
}

export async function extractReplyFromReply(
  replyText: string,
  context: { opportunityTitle?: string | null; trade?: string | null }
): Promise<ExtractedReply> {
  const text = replyText.slice(0, 8000);
  if (await claudeEnabled()) {
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
          "  - decline: they are not interested in this opportunity at all",
          "  - unavailable: they WOULD do this kind of work but cannot take THIS job now (busy, booked, capacity, timing). This is not a decline.",
          "  - cant_fulfill: they cannot perform the work (wrong trade, capacity, geography, licensing, etc.)",
          "  - question: they mainly ask clarifying questions",
          "  - partial_scope: they can do PART of what we asked but not all of it (with or without a price)",
          "  - needs_time: they want to quote but need longer than the deadline we gave",
          "  - wrong_contact: right company, wrong person; they are not who handles this",
          "  - referred: they point us at a different company or person to contact",
          "  - does_not_perform_trade: they do not work in this trade at all",
          "  - other: anything else (acknowledgement, out-of-office, unclear)",
          "Choose partial_scope over quote when they price only part of the work: the price is real,",
          "but recording it as full coverage is how a bid gets assembled with a hole in it.",
          "- is_quote is true ONLY if the reply states a price for the work itself (not fees, not example figures, not questions about price).",
          "- quote_amount: total price in whole US dollars (never cents). If they give a range, use the midpoint. Null when no price.",
          "- payment_terms: any stated terms (e.g. 'net 30', '50% mobilization'), else null.",
          "- notes: a one-to-two sentence summary of conditions, exclusions, or caveats they mention, else null.",
          "- company_name: the company name from their signature if present, else null.",
          "- can_perform: true/false when they clearly say they can or cannot do the work; else null.",
          "- capability_notes: short summary of what they can/cannot do and why (especially for decline / cant_fulfill), else null.",
          "- trades_mentioned: list of trades they mention covering or not covering; empty array if none.",
          "- scope_summary: what work they are actually pricing, in their words, else null.",
          "- labor_cost / material_cost: whole dollars when they break the price out; null when they give only a total.",
          "- exclusions: work they explicitly say is NOT included. Empty array if none stated.",
          "- qualifications: conditions attached to the price (permits by others, price escalation, access needed). Empty array if none.",
          "- lead_time_days: whole days before they can start, converting weeks to days. Null when not stated.",
          "- availability_notes: their stated availability window when no clean number exists, else null.",
          "- quote_valid_until: how long the price holds, as they state it, else null.",
          "- price_is_firm: true if they call it firm/fixed, false if they call it an estimate/budgetary/ROM. Null when they do not say.",
          "- taxes_included: true/false only when they say whether tax is in the number, else null.",
          "- alternates: optional prices for doing the work differently (a different product, a phased schedule). Empty array if none.",
          "- earliest_start: the soonest they say they could start, in their words, else null.",
          "- covers_full_scope: false ONLY when they say they are covering part of what we asked for.",
          "  True when they say or clearly imply the whole scope. Null when they do not address it.",
          "- uncovered_scope: the part they are NOT covering, in their words. Null unless covers_full_scope is false.",
          "- referred_to: a person, company or email address they point us at instead of themselves, else null.",
          "- missing_fields: bid information a buyer would still need that this reply does not answer.",
          "  Use short field names such as: price, scope, lead_time, exclusions, payment_terms, bonding, insurance, licensing.",
          "  Empty array when the reply is complete for its intent.",
          "- conflicts: statements that contradict each other or the request (two different prices,",
          "  a scope they exclude but also price, a start date after the deadline). Empty array if none.",
          "- confidence: 0 to 1, how sure you are of intent AND the numbers.",
          "  Be strict. Use below 0.6 when the email is vague, forwarded, quotes another thread,",
          "  is machine-generated, or when you are inferring a price rather than reading one.",
          "  A low score sends this to a human, which is always the correct outcome when unsure.",
          "",
          "Never invent a value. A field you cannot read from the email is null or an empty array.",
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
        scopeSummary: data.scope_summary,
        laborCost: sanePositive(data.labor_cost),
        materialCost: sanePositive(data.material_cost),
        exclusions: data.exclusions ?? [],
        qualifications: data.qualifications ?? [],
        priceIsFirm: data.price_is_firm,
        taxesIncluded: data.taxes_included,
        alternates: data.alternates ?? [],
        earliestStart: data.earliest_start,
        /*
         * Only a stated "no" counts as partial. An extractor guessing that a
         * quote is incomplete would send us chasing coverage we already have,
         * so silence here means "they did not say", not "they did not cover it".
         */
        coversFullScope:
          intent === "partial_scope" ? false : data.covers_full_scope,
        uncoveredScope: data.uncovered_scope,
        referredTo: data.referred_to,
        leadTimeDays:
          data.lead_time_days != null &&
          Number.isFinite(data.lead_time_days) &&
          data.lead_time_days >= 0 &&
          data.lead_time_days <= 3650
            ? Math.round(data.lead_time_days)
            : null,
        availabilityNotes: data.availability_notes,
        quoteValidUntil: data.quote_valid_until,
        missingFields: data.missing_fields ?? [],
        conflicts: data.conflicts ?? [],
        // Clamp: a model returning 1.4 must not read as extra-confident.
        confidence: Math.min(1, Math.max(0, Number(data.confidence) || 0)),
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
