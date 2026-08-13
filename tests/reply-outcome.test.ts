import { describe, it, expect } from "vitest";
import {
  decideReply,
  outcomeForIntent,
  blockingGaps,
  MIN_ACT_CONFIDENCE,
} from "@/lib/domain/reply-outcome";
import type { ExtractedReply } from "@/lib/ai/reply-extract";

function reply(over: Partial<ExtractedReply> = {}): ExtractedReply {
  return {
    intent: "interested",
    isQuote: false,
    quoteAmount: null,
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
    missingFields: [],
    conflicts: [],
    confidence: 0.9,
    method: "ai",
    ...over,
  };
}

/**
 * The distinction that protects a subcontractor's future work: being booked
 * this month is not declining, and being wrong for this scope is not either.
 */
describe("intent maps to a per-solicitation outcome", () => {
  it("keeps unavailable separate from declined", () => {
    expect(outcomeForIntent("unavailable", false)).toBe("unavailable");
    expect(outcomeForIntent("decline", false)).toBe("declined");
    expect(outcomeForIntent("cant_fulfill", false)).toBe("not_a_fit");
  });

  it("never records a quote without a usable amount", () => {
    // The model said "quote" but no amount survived validation.
    expect(outcomeForIntent("quote", false)).toBe("interested");
    expect(outcomeForIntent("quote", true)).toBe("quoted");
  });
});

describe("automation only proceeds when the read is trustworthy", () => {
  it("acts on a confident, consistent reply", () => {
    expect(decideReply(reply())).toMatchObject({ act: true, needsReview: false });
  });

  it("refuses to act on a low-confidence read", () => {
    const d = decideReply(reply({ confidence: MIN_ACT_CONFIDENCE - 0.01 }));
    expect(d.act).toBe(false);
    expect(d.needsReview).toBe(true);
  });

  it("refuses to act when the reply contradicts itself", () => {
    const d = decideReply(reply({ conflicts: ["quotes $10,000 and $12,500"] }));
    expect(d.act).toBe(false);
    expect(d.reviewReason).toContain("contradicts itself");
  });

  it("refuses to act on a regex-only extraction however large the number", () => {
    // A dollar figure found by pattern matching is not comprehension.
    const d = decideReply(reply({ method: "regex", confidence: 1, isQuote: true }));
    expect(d.act).toBe(false);
    expect(d.needsReview).toBe(true);
  });
});

describe("workflow is held until the bid information is complete", () => {
  it("blocks a quote missing a price or scope", () => {
    expect(blockingGaps(reply({ isQuote: true, intent: "quote" }), "quoted")).toEqual(
      expect.arrayContaining(["price", "scope"])
    );
  });

  it("passes a complete quote", () => {
    const e = reply({
      isQuote: true,
      intent: "quote",
      quoteAmount: 42000,
      scopeSummary: "Grounds maintenance, 12 months",
    });
    expect(blockingGaps(e, "quoted")).toEqual([]);
  });

  it("surfaces gaps the assistant itself flagged", () => {
    const e = reply({
      isQuote: true,
      quoteAmount: 42000,
      scopeSummary: "Mowing only",
      missingFields: ["lead_time", "insurance"],
    });
    expect(blockingGaps(e, "quoted")).toEqual(["lead_time", "insurance"]);
  });

  it("does not chase paperwork from someone who simply declined", () => {
    expect(blockingGaps(reply({ missingFields: ["price"] }), "declined")).toEqual([]);
  });
});

describe("an unreadable attachment is unknown content, not absent content", () => {
  it("refuses to act when a quote document could not be read and no price was found", () => {
    const d = decideReply(reply({ intent: "quote" }), {
      unreadableAttachments: ["Quote.pdf"],
    });
    expect(d.act).toBe(false);
    expect(d.reviewReason).toContain("Quote.pdf");
  });

  it("still acts when the price was read from the body despite an unreadable extra file", () => {
    const d = decideReply(
      reply({ intent: "quote", isQuote: true, quoteAmount: 42000 }),
      { unreadableAttachments: ["logo-scan.pdf"] }
    );
    expect(d.act).toBe(true);
  });
});
