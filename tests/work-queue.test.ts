import { describe, it, expect } from "vitest";
import { sortWorkItems, summarizeQueue, type WorkItem } from "@/lib/domain/work-queue";

function item(over: Partial<WorkItem>): WorkItem {
  return {
    key: over.key ?? Math.random().toString(36).slice(2),
    kind: "call",
    title: "Call someone",
    context: "Some job",
    href: "/call-queue",
    actionLabel: "Call",
    ...over,
  };
}

describe("the one work queue", () => {
  it("puts the bid closest to money first, then quotes, calls, decisions", () => {
    const sorted = sortWorkItems([
      item({ kind: "decide", key: "d" }),
      item({ kind: "call", key: "c" }),
      item({ kind: "review_bid", key: "b" }),
      item({ kind: "enter_quote", key: "q" }),
    ]);
    expect(sorted.map((i) => i.key)).toEqual(["b", "q", "c", "d"]);
  });

  it("orders by nearest deadline inside a band, undated last", () => {
    const sorted = sortWorkItems([
      item({ key: "none", due: null }),
      item({ key: "far", due: "2026-09-20" }),
      item({ key: "soon", due: "2026-08-20" }),
    ]);
    expect(sorted.map((i) => i.key)).toEqual(["soon", "far", "none"]);
  });

  it("summarizes in plain language, singulars and plurals right", () => {
    expect(
      summarizeQueue([
        item({ kind: "review_bid" }),
        item({ kind: "call", key: "c1" }),
        item({ kind: "call", key: "c2" }),
      ])
    ).toBe("3 to do: 1 bid to review, 2 calls");
  });

  it("says so when the queue is empty", () => {
    expect(summarizeQueue([])).toBe("Nothing waiting on you");
  });
});
