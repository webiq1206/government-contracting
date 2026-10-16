import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { proposeRow } from "@/lib/domain/quote-fields";
import { shouldAutoSaveQuote } from "@/lib/reply-matching";
import {
  declineReply,
  interestedNoPriceReply,
  pricedCateringReply,
  pricedElectricalReply,
} from "./fixtures/sub-replies";

const replies = [pricedElectricalReply, pricedCateringReply, interestedNoPriceReply, declineReply];

vi.mock("@/lib/ai/claude", () => ({
  claudeEnabled: vi.fn(async () => true),
  completeJson: vi.fn(async (prompt: string) => {
    const match = replies.find((reply) => prompt.includes(reply.text.slice(0, 40)));
    if (!match) throw new Error("fixture reply was not in the prompt");
    return { data: match.ai, usage: null };
  }),
}));

describe("reply prices filed to the quote ledger", () => {
  beforeEach(async () => {
    const claude = await import("@/lib/ai/claude");
    vi.mocked(claude.claudeEnabled).mockResolvedValue(true);
  });

  it("extracts a firm electrical total into a pricing row", async () => {
    const { extractReplyFromReply } = await import("@/lib/ai/reply-extract");
    const extracted = await extractReplyFromReply(pricedElectricalReply.text, {
      opportunityTitle: "Electrical maintenance, Dyess AFB",
      trade: "electrical",
    });
    expect(extracted.isQuote).toBe(true);
    expect(extracted.quoteAmount).toBe(48750);
    const proposal = proposeRow(extracted, {
      trade: "electrical",
      pairedTrades: ["electrical"],
      receivedAt: new Date("2026-10-16T18:00:00.000Z"),
    });
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    expect(proposal.row.baseQuote).toBe(48750);
    expect(shouldAutoSaveQuote({
      threadMatched: true,
      senderVerified: true,
      isQuote: extracted.isQuote,
      quoteAmount: extracted.quoteAmount,
    })).toBe(true);
  });

  it("keeps cents on a catering quote", async () => {
    const { extractReplyFromReply } = await import("@/lib/ai/reply-extract");
    const extracted = await extractReplyFromReply(pricedCateringReply.text, {
      opportunityTitle: "Dining facility attendant services",
      trade: "food service",
    });
    expect(extracted.quoteAmount).toBe(126400.5);
    const proposal = proposeRow(extracted, {
      trade: "food service",
      pairedTrades: ["food service"],
      receivedAt: new Date("2026-09-01T16:00:00.000Z"),
    });
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    expect(proposal.row.baseQuote).toBe(126400.5);
  });

  it("does not file a price for interest or a decline", async () => {
    const { extractReplyFromReply } = await import("@/lib/ai/reply-extract");
    for (const sample of [interestedNoPriceReply, declineReply]) {
      const extracted = await extractReplyFromReply(sample.text, {
        opportunityTitle: "Dining facility attendant services",
        trade: "food service",
      });
      expect(extracted.isQuote).toBe(false);
      expect(extracted.quoteAmount).toBeNull();
      expect(shouldAutoSaveQuote({
        threadMatched: true,
        senderVerified: true,
        isQuote: extracted.isQuote,
        quoteAmount: extracted.quoteAmount,
      })).toBe(false);
      expect(proposeRow(extracted, {
        trade: "food service",
        pairedTrades: ["food service"],
        receivedAt: new Date("2026-09-01T16:00:00.000Z"),
      }).ok).toBe(false);
    }
  });

  it("writes the proposed amount into the quotes ledger", () => {
    const src = readFileSync("lib/reply-quote.ts", "utf8");
    expect(src).toContain("quote_amount");
    expect(src).toContain("proposal.baseQuote");
    expect(src).toContain("saveProposedRow");
    const capture = readFileSync("lib/reply-capture.ts", "utf8");
    expect(capture).toContain("persistReplyQuote");
    expect(capture).toContain("shouldAutoSaveQuote");
  });
});
