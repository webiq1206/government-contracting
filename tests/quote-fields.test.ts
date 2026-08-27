import { describe, expect, it } from "vitest";
import {
  confidenceOf,
  proposeRow,
  resolveValidity,
  type QuoteContext,
  type QuoteReading,
} from "../lib/domain/quote-fields";

/**
 * A subcontractor's reply, turned into the row that prices their trade.
 *
 * The extractor already read the email carefully. All of it then went into a
 * `notes` string and stopped being data, so the estimator got an amount and a
 * paragraph, and every question the paragraph answered had to be asked again.
 *
 * What is asserted here is mostly the refusals, because the mapping itself is
 * only safe if the cases it declines to map are the right ones.
 */

const RECEIVED = new Date("2026-03-01T09:00:00Z");

function reading(patch: Partial<QuoteReading> = {}): QuoteReading {
  return {
    isQuote: true,
    quoteAmount: 100_000,
    paymentTerms: null,
    exclusions: [],
    alternates: [],
    qualifications: [],
    leadTimeDays: null,
    availabilityNotes: null,
    earliestStart: null,
    quoteValidUntil: null,
    priceIsFirm: null,
    taxesIncluded: null,
    taxesAmount: null,
    freightAmount: null,
    mobilizationAmount: null,
    bondingAmount: null,
    coversFullScope: null,
    uncoveredScope: null,
    conflicts: [],
    confidence: 0.9,
    ...patch,
  };
}

function ctx(patch: Partial<QuoteContext> = {}): QuoteContext {
  return { trade: "Electrical", pairedTrades: ["Electrical"], receivedAt: RECEIVED, ...patch };
}

describe("what a reply is not allowed to become", () => {
  it("refuses a reply that carries no price", () => {
    const p = proposeRow(reading({ isQuote: false, quoteAmount: null }), ctx());
    expect(p.ok).toBe(false);
    expect(p.ok === false && p.refusal).toBe("not_a_quote");
  });

  it("refuses a reply that reads as a quote but has no usable number", () => {
    const p = proposeRow(reading({ quoteAmount: null }), ctx());
    expect(p.ok === false && p.refusal).toBe("no_amount");
  });

  it("refuses a multi-trade pairing that does not say which trade it prices", () => {
    const p = proposeRow(
      reading(),
      ctx({ trade: null, pairedTrades: ["Electrical", "Low voltage"] })
    );
    // The dangerous case: a real price, correctly read, that cannot be filed.
    // Filing it under a guessed trade is worse, because a wrong trade is
    // invisible on every screen and a missing one is not.
    expect(p.ok === false && p.refusal).toBe("ambiguous_trade");
  });

  it("accepts a single-trade pairing that does not name the trade", () => {
    const p = proposeRow(reading(), ctx({ trade: null, pairedTrades: ["Plumbing"] }));
    expect(p.ok).toBe(true);
    expect(p.ok && p.row.trade).toBe("Plumbing");
  });

  it("refuses a reply that contradicts itself", () => {
    const p = proposeRow(reading({ conflicts: ["Two different totals given"] }), ctx());
    expect(p.ok === false && p.refusal).toBe("contradictory");
  });

  it("refuses a price that covers only part of the work, and says which part", () => {
    const p = proposeRow(
      reading({ coversFullScope: false, uncoveredScope: "Building C" }),
      ctx()
    );
    expect(p.ok === false && p.refusal).toBe("partial_scope");
    expect(p.ok === false && p.uncoveredScope).toBe("Building C");
  });

  it("refuses to touch a trade a person has already priced", () => {
    const p = proposeRow(reading(), ctx({ operatorRowExists: true }));
    expect(p.ok === false && p.refusal).toBe("operator_row_exists");
  });

  it("applies the same refusals on the single-trade shortcut", () => {
    // One rule in two places is how the copies drift, so the shortcut path
    // has to refuse exactly what the named-trade path refuses.
    const p = proposeRow(
      reading({ conflicts: ["Two totals"] }),
      ctx({ trade: null, pairedTrades: ["Plumbing"] })
    );
    expect(p.ok === false && p.refusal).toBe("contradictory");
  });
});

describe("what the row carries", () => {
  it("keeps every field the reply actually stated", () => {
    const p = proposeRow(
      reading({
        quoteAmount: 100_000,
        taxesAmount: 8_250,
        freightAmount: 1_200,
        paymentTerms: "Net 30",
        leadTimeDays: 21,
        priceIsFirm: true,
        quoteValidUntil: "30 days",
        availabilityNotes: "Crew free from mid-July",
      }),
      ctx()
    );
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.row.baseQuote).toBe(100_000);
    expect(p.row.taxes).toBe(8_250);
    expect(p.row.freight).toBe(1_200);
    expect(p.row.paymentTerms).toBe("Net 30");
    expect(p.row.leadTimeDays).toBe(21);
    expect(p.row.confidence).toBe("firm");
    expect(p.row.quoteExpiresOn).toBe("2026-03-31");
  });

  it("leaves a component the reply never mentioned as null, not zero", () => {
    const p = proposeRow(reading(), ctx());
    expect(p.ok && p.row.freight).toBeNull();
    expect(p.ok && p.row.mobilization).toBeNull();
    expect(p.ok && p.row.bonding).toBeNull();
  });

  it("marks tax pending when they say it is excluded and do not say how much", () => {
    const p = proposeRow(reading({ taxesIncluded: false, taxesAmount: null }), ctx());
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.row.taxes).toBeNull();
    // The whole point: the trade total must not add up as though there were
    // no tax, because they have just said there is.
    expect(p.row.pendingComponents).toContain("taxes");
    expect(p.row.missing).toContain("taxes");
  });

  it("does not mark tax pending when they gave the figure", () => {
    const p = proposeRow(reading({ taxesIncluded: false, taxesAmount: 8_250 }), ctx());
    expect(p.ok && p.row.pendingComponents).toEqual([]);
    expect(p.ok && p.row.taxes).toBe(8_250);
  });

  it("does not mark tax pending when the price includes it", () => {
    const p = proposeRow(reading({ taxesIncluded: true }), ctx());
    expect(p.ok && p.row.pendingComponents).toEqual([]);
    expect(p.ok && p.row.missing).not.toContain("taxes");
  });

  it("files every exclusion as nobody assigned", () => {
    const p = proposeRow(reading({ exclusions: ["Crane and rigging", "Permits"] }), ctx());
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.row.exclusions).toHaveLength(2);
    // A subcontractor saying they will not do something is not a statement
    // about who will, so nothing here closes the hole.
    for (const e of p.row.exclusions) expect(e.coveredBy).toBe("unassigned");
  });

  it("records an offered alternate without pricing it or putting it in the bid", () => {
    const p = proposeRow(reading({ alternates: ["Aluminium conductor instead of copper"] }), ctx());
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.row.alternates[0]?.amount).toBeNull();
    expect(p.row.alternates[0]?.included).toBe(false);
  });

  it("keeps qualifications as notes rather than as exclusions", () => {
    const p = proposeRow(
      reading({ qualifications: ["Assumes permits are pulled by others"] }),
      ctx()
    );
    // Folding an assumption into the exclusion list would make a condition
    // look like a coverage hole and block the bid over it.
    expect(p.ok && p.row.exclusions).toEqual([]);
    expect(p.ok && p.row.notes).toContain("Assumes permits are pulled by others");
  });
});

describe("how firm the number is", () => {
  it("never upgrades silence to firm", () => {
    expect(confidenceOf(reading({ priceIsFirm: null }))).toBe("unknown");
    expect(confidenceOf(reading({ priceIsFirm: true }))).toBe("firm");
    expect(confidenceOf(reading({ priceIsFirm: false }))).toBe("budgetary");
  });
});

describe("turning a validity phrase into a date", () => {
  it("counts a plain period from when they wrote", () => {
    expect(resolveValidity("30 days", RECEIVED)).toBe("2026-03-31");
    expect(resolveValidity("2 weeks", RECEIVED)).toBe("2026-03-15");
  });

  it("counts business days as business days", () => {
    // Ten business days is a fortnight, not ten calendar days.
    expect(resolveValidity("10 business days", RECEIVED)).toBe("2026-03-15");
  });

  it("reads a date they actually gave", () => {
    expect(resolveValidity("good through 2026-06-30", RECEIVED)).toBe("2026-06-30");
    expect(resolveValidity("valid until 6/30/2026", RECEIVED)).toBe("2026-06-30");
    expect(resolveValidity("holds until June 30, 2026", RECEIVED)).toBe("2026-06-30");
  });

  it("refuses to invent a date from a phrase that has none", () => {
    // Each of these is a real thing subcontractors write, and none of them is
    // a date. An invented expiry is worse than an absent one: the row would
    // say the price is good until a day nobody promised.
    for (const phrase of [
      "until the end of the month",
      "subject to review",
      "until material prices move",
      "while stocks last",
      "",
    ]) {
      expect(resolveValidity(phrase, RECEIVED)).toBeNull();
    }
  });

  it("refuses an implausible period rather than producing a far-future date", () => {
    expect(resolveValidity("9999 days", RECEIVED)).toBeNull();
    expect(resolveValidity("0 days", RECEIVED)).toBeNull();
  });

  it("has nothing to say when they said nothing", () => {
    expect(resolveValidity(null, RECEIVED)).toBeNull();
  });
});

describe("what still has to be asked", () => {
  it("names the gaps rather than filling them", () => {
    const p = proposeRow(reading(), ctx());
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.row.missing).toEqual(
      expect.arrayContaining(["taxes", "lead_time", "payment_terms", "quote_validity", "price_firmness"])
    );
  });

  it("has nothing to ask when the reply answered everything", () => {
    const p = proposeRow(
      reading({
        taxesIncluded: true,
        paymentTerms: "Net 30",
        quoteValidUntil: "45 days",
        priceIsFirm: true,
        leadTimeDays: 14,
      }),
      ctx()
    );
    expect(p.ok && p.row.missing).toEqual([]);
  });
});
