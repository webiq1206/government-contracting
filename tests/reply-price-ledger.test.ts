import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { proposeRow } from "@/lib/domain/quote-fields";
import { shouldAutoDecline, shouldAutoSaveQuote } from "@/lib/reply-matching";
import {
  declineReply,
  forwardedThreadReply,
  interestedNoPriceReply,
  lineItemNoTotalReply,
  lineItemWithTotalReply,
  pdfAttachmentReply,
  pricedCateringReply,
  pricedElectricalReply,
  rangeReply,
  shorthandPriceReply,
} from "./fixtures/sub-replies";

const replies = [
  pricedElectricalReply,
  pricedCateringReply,
  interestedNoPriceReply,
  declineReply,
  lineItemNoTotalReply,
  lineItemWithTotalReply,
  shorthandPriceReply,
  pdfAttachmentReply,
  rangeReply,
  forwardedThreadReply,
];

const quoteWrites: { sql: string; params: unknown[] }[] = [];

vi.mock("@/lib/db", () => ({
  transaction: async (fn: (client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: { id: string }[] }> }) => Promise<unknown>) =>
    fn({
      query: async (sql: string, params: unknown[] = []) => {
        quoteWrites.push({ sql, params });
        if (/insert into quotes/i.test(sql)) return { rows: [{ id: "quote-1" }] };
        if (/select id from opportunities/i.test(sql)) return { rows: [{ id: "opp-1" }] };
        if (/select id from opportunity_subs/i.test(sql)) return { rows: [{ id: "pair-1" }] };
        return { rows: [] };
      },
    }),
}));

vi.mock("@/lib/pricing-rows", () => ({
  saveProposedRow: vi.fn(async () => "saved"),
}));

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

  it("files a stated lump sum and rejects a calculated extension, a range, and shorthand that is not written as dollars", async () => {
    const { extractReplyFromReply } = await import("@/lib/ai/reply-extract");
    const { extractQuoteFromReply } = await import("@/lib/ai/quote-extract");
    const stated = await extractReplyFromReply(lineItemWithTotalReply.text, { trade: "electrical" });
    expect(stated.quoteAmount).toBe(12500);
    expect(stated.isQuote).toBe(true);
    const viaAlias = await extractQuoteFromReply(pricedElectricalReply.text, { trade: "electrical" });
    expect(viaAlias.quoteAmount).toBe(48750);

    const extended = await extractReplyFromReply(lineItemNoTotalReply.text, { trade: "electrical" });
    expect(extended.quoteAmount).toBeNull();
    expect(extended.isQuote).toBe(false);

    const range = await extractReplyFromReply(rangeReply.text, { trade: "electrical" });
    expect(range.quoteAmount).toBeNull();
    expect(range.isQuote).toBe(false);

    const shorthand = await extractReplyFromReply(shorthandPriceReply.text, { trade: "food service" });
    expect(shorthand.quoteAmount).toBe(12500);
    const attached = await extractReplyFromReply(pdfAttachmentReply.text, { trade: "electrical" });
    expect(attached.quoteAmount).toBe(48750);
    const forwarded = await extractReplyFromReply(forwardedThreadReply.text, { trade: "electrical" });
    expect(forwarded.quoteAmount).toBe(48750);
  });

  it("writes a priced reply into the quotes ledger and writes no price for a decline or an interested reply", async () => {
    const { extractReplyFromReply } = await import("@/lib/ai/reply-extract");
    const { persistReplyQuote } = await import("@/lib/reply-quote");
    const { saveProposedRow } = await import("@/lib/pricing-rows");
    quoteWrites.length = 0;
    const extracted = await extractReplyFromReply(pricedElectricalReply.text, { trade: "electrical" });
    const proposal = proposeRow(extracted, {
      trade: "electrical",
      pairedTrades: ["electrical"],
      receivedAt: new Date("2026-10-16T18:00:00.000Z"),
    });
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    const saved = await persistReplyQuote({
      orgId: "11111111-1111-1111-1111-111111111111",
      opportunityId: "22222222-2222-2222-2222-222222222222",
      subcontractorId: "33333333-3333-3333-3333-333333333333",
      proposal: proposal.row,
      notes: "Firm electrical total",
      receivedAt: new Date("2026-10-16T18:00:00.000Z"),
    });
    expect(saved).toBe("saved");
    expect(quoteWrites.some((call) => /insert into quotes/i.test(call.sql) && call.params.includes(48750))).toBe(true);
    expect(saveProposedRow).toHaveBeenCalled();

    quoteWrites.length = 0;
    vi.mocked(saveProposedRow).mockClear();
    for (const sample of [declineReply, interestedNoPriceReply]) {
      const reading = await extractReplyFromReply(sample.text, { trade: "food service" });
      expect(reading.isQuote).toBe(false);
      expect(reading.quoteAmount).toBeNull();
      expect(shouldAutoSaveQuote({
        threadMatched: true,
        senderVerified: true,
        isQuote: reading.isQuote,
        quoteAmount: reading.quoteAmount,
      })).toBe(false);
    }
    expect(shouldAutoDecline({ senderVerified: true, intent: "decline" })).toBe(true);
    expect(shouldAutoDecline({ senderVerified: true, intent: "interested" })).toBe(false);
    const closeout = readFileSync("lib/domain/decline-closeout.ts", "utf8");
    const capture = readFileSync("lib/reply-capture.ts", "utf8");
    expect(closeout).toContain("outreach_state='declined'");
    expect(capture).toContain("outreach_state='responsive'");
    expect(capture).toContain("quoteSaved: false");
    expect(quoteWrites).toEqual([]);
    expect(saveProposedRow).not.toHaveBeenCalled();
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
