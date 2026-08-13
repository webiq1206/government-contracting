import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * Advancing a solicitation with a hole in its pricing produces a bid with a
 * hole in it, so most of these tests are about refusing to advance.
 */
async function load(opts: {
  trades?: { trade: string | null; total: number; negative: number; quotes: number }[];
  pendingReview?: number;
  updated?: boolean;
}) {
  vi.resetModules();
  const update = vi.fn(async () => (opts.updated === false ? [] : [{ id: "o1" }]));
  vi.doMock("@/lib/logger", () => ({ logAgent: vi.fn(async () => {}) }));
  vi.doMock("@/lib/db", () => ({
    query: vi.fn(async (sql: string) => {
      if (sql.includes("from opportunity_subs")) {
        return (opts.trades ?? []).map((t) => ({
          trade: t.trade,
          total: String(t.total),
          negative: String(t.negative),
          quote_count: String(t.quotes),
        }));
      }
      if (sql.includes("subcontractor_reply_events")) {
        return [{ n: String(opts.pendingReview ?? 0) }];
      }
      if (sql.includes("update opportunities")) return update();
      return [];
    }),
  }));
  return { mod: await import("@/lib/domain/advance-stage"), update };
}

afterEach(() => {
  vi.doUnmock("@/lib/db");
  vi.doUnmock("@/lib/logger");
  vi.resetModules();
});

const priced = { trade: "Landscaping", total: 3, negative: 1, quotes: 1 };

describe("holding a solicitation back", () => {
  it("holds when a trade has no quote yet", async () => {
    const { mod } = await load({
      trades: [priced, { trade: "Fencing", total: 2, negative: 0, quotes: 0 }],
    });
    const a = await mod.assessQuoteCompleteness("o1");
    expect(a.canAdvance).toBe(false);
    expect(a.holds.join(" ")).toContain("Fencing");
  });

  it("holds, and says so differently, when every sub for a trade is out", async () => {
    const { mod } = await load({
      trades: [priced, { trade: "Fencing", total: 2, negative: 2, quotes: 0 }],
    });
    const a = await mod.assessQuoteCompleteness("o1");
    expect(a.canAdvance).toBe(false);
    // This is not a waiting problem; a person has to find more subs.
    expect(a.holds.join(" ")).toContain("more options");
    expect(a.trades.find((t) => t.trade === "Fencing")!.exhausted).toBe(true);
  });

  it("holds while any reply is still waiting to be read", async () => {
    const { mod } = await load({ trades: [priced], pendingReview: 1 });
    const a = await mod.assessQuoteCompleteness("o1");
    expect(a.canAdvance).toBe(false);
    expect(a.holds.join(" ")).toContain("waiting for you to read");
  });

  it("holds when nobody has been approached at all", async () => {
    const { mod } = await load({ trades: [] });
    const a = await mod.assessQuoteCompleteness("o1");
    expect(a.canAdvance).toBe(false);
    expect(a.holds.join(" ")).toContain("No subcontractors");
  });
});

describe("advancing", () => {
  it("advances when every trade is priced and nothing is in question", async () => {
    const { mod } = await load({ trades: [priced, { trade: "Fencing", total: 2, negative: 0, quotes: 2 }] });
    const res = await mod.advanceIfQuotesComplete("o1");
    expect(res.advanced).toBe(true);
    expect(res.enqueue).toMatchObject({ agent: "bid-builder" });
  });

  it("does not advance a record that has already moved on", async () => {
    // The stage guard lives in the UPDATE, so a no-op update means no advance.
    const { mod } = await load({ trades: [priced], updated: false });
    const res = await mod.advanceIfQuotesComplete("o1");
    expect(res.advanced).toBe(false);
    expect(res.enqueue).toBeUndefined();
  });

  it("never touches the record when the assessment says hold", async () => {
    const { mod, update } = await load({
      trades: [{ trade: "Fencing", total: 2, negative: 0, quotes: 0 }],
    });
    const res = await mod.advanceIfQuotesComplete("o1");
    expect(res.advanced).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});
