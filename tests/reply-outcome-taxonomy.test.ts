/**
 * The outcomes a reply is allowed to produce.
 *
 * Every case added here was previously flattened into something that read as a
 * settled answer when it was not. The expensive one is partial coverage: a
 * subcontractor who prices two of three buildings has sent a real number, the
 * old rule recorded it as the trade being covered, and the email reads like a
 * complete quote. Nobody catches it until the bid is short a building.
 */
import { describe, it, expect } from "vitest";
import {
  outcomeForIntent,
  decideReply,
  blockingGaps,
  OUTCOME_LABEL,
  type ReplyOutcome,
} from "@/lib/domain/reply-outcome";
import type { ExtractedReply } from "@/lib/ai/reply-extract";

function reply(over: Partial<ExtractedReply> = {}): ExtractedReply {
  return {
    intent: "other",
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
    priceIsFirm: null,
    taxesIncluded: null,
    alternates: [],
    earliestStart: null,
    coversFullScope: null,
    uncoveredScope: null,
    referredTo: null,
    missingFields: [],
    conflicts: [],
    confidence: 0.9,
    method: "ai",
    ...over,
  };
}

describe("outcomeForIntent", () => {
  it("maps each intent to its own outcome", () => {
    const cases: [Parameters<typeof outcomeForIntent>[0], ReplyOutcome][] = [
      ["interested", "interested"],
      ["decline", "declined"],
      ["unavailable", "unavailable"],
      ["cant_fulfill", "not_a_fit"],
      ["question", "needs_info"],
      ["needs_time", "needs_time"],
      ["wrong_contact", "wrong_contact"],
      ["referred", "referred"],
      ["does_not_perform_trade", "does_not_perform_trade"],
    ];
    for (const [intent, expected] of cases) {
      expect(outcomeForIntent(intent, false), intent).toBe(expected);
    }
  });

  it("treats a price as a quote", () => {
    expect(outcomeForIntent("quote", true)).toBe("quoted");
  });

  it("does not call a partial price a quote", () => {
    /*
     * The rule the whole taxonomy turns on. "If there is a price, it is a
     * quote" is true right up until the price covers two thirds of the work.
     */
    expect(outcomeForIntent("quote", true, false)).toBe("partial_scope");
    expect(outcomeForIntent("partial_scope", true)).toBe("partial_scope");
  });

  it("still calls a full-coverage price a quote", () => {
    expect(outcomeForIntent("quote", true, true)).toBe("quoted");
  });

  it("says nothing when coverage was not addressed", () => {
    // Silence means "they did not say", not "they did not cover it". Guessing
    // otherwise sends us chasing coverage we already have.
    expect(outcomeForIntent("quote", true, null)).toBe("quoted");
  });

  it("gives every outcome a label a person can read", () => {
    for (const key of Object.keys(OUTCOME_LABEL) as ReplyOutcome[]) {
      expect(OUTCOME_LABEL[key], key).toBeTruthy();
    }
  });
});

describe("decideReply", () => {
  it("acts on a clear, complete reply", () => {
    const d = decideReply(reply({ intent: "decline", confidence: 0.9 }));
    expect(d).toMatchObject({ outcome: "declined", act: true, needsReview: false });
  });

  it("routes a partial quote to partial_scope, not quoted", () => {
    const d = decideReply(
      reply({
        intent: "quote",
        isQuote: true,
        quoteAmount: 42000,
        coversFullScope: false,
        uncoveredScope: "Building 4 is outside our service area",
      })
    );
    expect(d.outcome).toBe("partial_scope");
    expect(d.act).toBe(true);
  });

  it("never acts on a reply it only pattern-matched", () => {
    expect(decideReply(reply({ method: "regex" })).act).toBe(false);
  });

  it("never acts on a reply that contradicts itself", () => {
    const d = decideReply(reply({ conflicts: ["quotes $40,000 and $60,000"] }));
    expect(d.act).toBe(false);
    expect(d.reviewReason).toMatch(/contradicts itself/);
  });

  it("holds a reply whose quote may be in an unreadable attachment", () => {
    // "No price in the body" is not "no price" when they attached a scan.
    const d = decideReply(reply({ intent: "quote" }), {
      unreadableAttachments: ["quote.pdf"],
    });
    expect(d.act).toBe(false);
    expect(d.reviewReason).toMatch(/quote\.pdf/);
  });

  it("holds anything it is not confident about", () => {
    expect(decideReply(reply({ confidence: 0.4 })).act).toBe(false);
  });
});

describe("blockingGaps", () => {
  it("chases the price and scope on a full quote", () => {
    expect(blockingGaps(reply({ isQuote: true }), "quoted")).toEqual(
      expect.arrayContaining(["price", "scope"])
    );
  });

  it("chases the uncovered part on a partial quote", () => {
    /*
     * Without it, "partial" is a label on a record that nobody can act on:
     * we know the coverage is short and not which part is short.
     */
    expect(blockingGaps(reply({ quoteAmount: 42000 }), "partial_scope")).toEqual([
      "uncovered_scope",
    ]);
  });

  it("is satisfied by a partial quote that says what it excludes", () => {
    expect(
      blockingGaps(
        reply({ quoteAmount: 42000, uncoveredScope: "Building 4" }),
        "partial_scope"
      )
    ).toEqual([]);
  });

  it("chases nothing on a decline", () => {
    expect(blockingGaps(reply({ intent: "decline" }), "declined")).toEqual([]);
  });
});
