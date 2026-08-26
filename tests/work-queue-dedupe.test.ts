/**
 * One problem, one row.
 *
 * An opportunity flagged for human attention while sitting in bid_building
 * produced two entries: "Resolve blocker" and "Review & submit bid". One piece
 * of work, two rows, and a count at the top of Today that disagreed with the
 * list underneath it -- which is how a number stops being believed.
 */
import { describe, it, expect } from "vitest";
import { dedupeWorkItems, sortWorkItems, type WorkItem } from "@/lib/domain/work-queue";

function item(over: Partial<WorkItem> & Pick<WorkItem, "key" | "kind">): WorkItem {
  return {
    title: "t",
    context: "c",
    href: "/x",
    actionLabel: "Go",
    ...over,
  };
}

describe("dedupeWorkItems", () => {
  it("keeps one row per record", () => {
    const out = dedupeWorkItems([
      item({ key: "act:opp-1", kind: "fix_blocker" }),
      item({ key: "review:opp-1", kind: "review_bid" }),
    ]);
    expect(out).toHaveLength(1);
  });

  it("keeps the one whose action actually resolves the pair", () => {
    /*
     * review_bid outranks fix_blocker in queue order, and it is the row whose
     * action opens the thing that clears both. Keeping the blocker row would
     * send the operator to a page that tells them to do what the other row
     * was already offering.
     */
    const out = dedupeWorkItems([
      item({ key: "act:opp-1", kind: "fix_blocker", actionLabel: "Resolve" }),
      item({ key: "review:opp-1", kind: "review_bid", actionLabel: "Review bid" }),
    ]);
    expect(out[0].actionLabel).toBe("Review bid");
  });

  it("leaves genuinely different records alone", () => {
    const out = dedupeWorkItems([
      item({ key: "act:opp-1", kind: "fix_blocker" }),
      item({ key: "act:opp-2", kind: "fix_blocker" }),
      item({ key: "call:card-9", kind: "call" }),
    ]);
    expect(out).toHaveLength(3);
  });

  it("returns the queue already sorted", () => {
    const out = dedupeWorkItems([
      item({ key: "decide:a", kind: "decide" }),
      item({ key: "reply:b", kind: "read_reply" }),
    ]);
    expect(out.map((i) => i.kind)).toEqual(["read_reply", "decide"]);
    expect(out).toEqual(sortWorkItems(out));
  });

  it("does not drop an item whose key has no record part", () => {
    // Defensive: a malformed key should cost one duplicate row, never a
    // silently vanished piece of work.
    const out = dedupeWorkItems([item({ key: "orphan", kind: "call" })]);
    expect(out).toHaveLength(1);
  });
});

describe("reason and blocker", () => {
  it("are optional, so an item without them still type-checks and renders", () => {
    const plain = item({ key: "call:1", kind: "call" });
    expect(plain.reason).toBeUndefined();
    expect(plain.blocker).toBeUndefined();
  });
});
