import { describe, expect, it } from "vitest";
import { decideReply, OUTCOME_LABEL } from "../lib/domain/reply-outcome";
import type { ExtractedReply } from "../lib/ai/reply-extract";

/**
 * A reply nobody understood must not be labelled as if somebody did.
 *
 * `decideReply` already refused to act on an unreadable or self-contradictory
 * reply, and that was the important half. What it still did was return the
 * model's proposed outcome, so a message nobody could read sat on a screen
 * labelled "Declined" with a small review tick beside it. The label is the
 * thing people read; the tick is the thing they scroll past.
 */

const extracted = (over: Partial<ExtractedReply> = {}): ExtractedReply =>
  ({
    intent: "decline",
    isQuote: false,
    quoteAmount: null,
    scopeSummary: null,
    uncoveredScope: null,
    coversFullScope: null,
    confidence: 0.9,
    conflicts: [],
    missingFields: [],
    method: "ai",
    ...over,
  }) as ExtractedReply;

describe("a reply the product could not read", () => {
  it("is labelled unclear, not by whatever the pattern matcher guessed", () => {
    const d = decideReply(extracted({ method: "regex" }));
    expect(d.outcome).toBe("unclear");
    expect(OUTCOME_LABEL[d.outcome]).toBe("Unclear, needs review");
    expect(d.act).toBe(false);
    expect(d.needsReview).toBe(true);
  });

  it("keeps the guess, so a reviewer starts from something", () => {
    // Not thrown away. A reviewer opening this should see what the reading
    // suggested, then decide.
    const d = decideReply(extracted({ method: "regex" }));
    expect(d.proposed).toBe("declined");
  });

  it("is unclear when the reading was not confident enough to act", () => {
    const d = decideReply(extracted({ confidence: 0.3 }));
    expect(d.outcome).toBe("unclear");
    expect(d.proposed).toBe("declined");
  });

  it("is unclear when the reply contradicts itself", () => {
    // A message with two meanings has no single one to record.
    const d = decideReply(extracted({ conflicts: ["says yes then gives a decline reason"] }));
    expect(d.outcome).toBe("unclear");
    expect(d.reviewReason).toContain("contradicts itself");
  });

  it("is NOT unclear when only the price is missing", () => {
    /*
     * "Our price is attached" is a perfectly plain reply whose attachment
     * could not be opened. What is missing is the price, not the meaning, and
     * relabelling it would throw away the one thing the reading established.
     */
    const d = decideReply(extracted({ intent: "quote", isQuote: false, confidence: 0.95 }), {
      unreadableAttachments: ["quote.pdf"],
    });
    expect(d.outcome).toBe("interested");
    expect(d.proposed).toBeNull();
    expect(d.act).toBe(false);
    expect(d.reviewReason).toContain("quote.pdf");
  });

  it("leaves a confident, consistent reading exactly as it was", () => {
    const d = decideReply(extracted());
    expect(d.outcome).toBe("declined");
    expect(d.proposed).toBeNull();
    expect(d.act).toBe(true);
    expect(d.needsReview).toBe(false);
  });

  it("never lets unclear write a state onto the pairing", () => {
    // The outcome has no outreach_state, which is what makes the refusal
    // structural rather than a rule somebody has to remember.
    expect(OUTCOME_LABEL.unclear).toBe("Unclear, needs review");
  });
});
