/**
 * Whose move is it.
 *
 * The queue could say what was late and what was not. It could not say what
 * was on the operator and what was on somebody else, and those look identical
 * on a list: a blocked item and a quote request that went out yesterday both
 * render as a row with a deadline. So an operator reading twenty rows had no
 * way to tell the eight that needed them from the twelve that did not, on the
 * page built to answer exactly that.
 *
 * Two axes now. Dates cut one way, whose-move cuts the other, and they cross:
 * work can be overdue AND waiting on somebody else, which is a real and
 * uncomfortable situation worth being able to select.
 */
import { describe, it, expect } from "vitest";
import {
  stateOf,
  taskFingerprint,
  filterWorkItems,
  bucketOf,
  QUEUE_FILTERS,
  QUEUE_FILTER_LABEL,
  type WorkItem,
} from "../lib/domain/work-queue";

const NOW = new Date("2026-08-26T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

function item(over: Partial<WorkItem> & Pick<WorkItem, "key">): WorkItem {
  return {
    kind: "decide",
    title: "A thing",
    context: "An opportunity",
    href: "/x",
    actionLabel: "Do it",
    ...over,
  } as WorkItem;
}

describe("stateOf", () => {
  it("calls ordinary work needs_attention", () => {
    expect(stateOf(item({ key: "decide:1" }))).toBe("needs_attention");
  });

  it("calls a blocked item blocked", () => {
    expect(stateOf(item({ key: "decide:1", blocker: "No pricing found" }))).toBe("blocked");
  });

  it("calls an unanswered request waiting_on_others", () => {
    expect(stateOf(item({ key: "awaiting:1", waitingOn: { party: "Rivera" } }))).toBe(
      "waiting_on_others"
    );
  });

  it("prefers blocked when an item is both", () => {
    /*
     * A send that failed to a contact we were already waiting on carries both.
     * Something that went wrong outranks something merely pending: the first
     * needs a person, the second needs a clock.
     */
    const both = item({ key: "awaiting:1", blocker: "Email bounced", waitingOn: { party: "Rivera" } });
    expect(stateOf(both)).toBe("blocked");
  });
});

describe("the two axes cross", () => {
  const overdueAndWaiting = item({
    key: "awaiting:1",
    due: day(-3),
    waitingOn: { party: "Rivera", since: day(-9) },
  });

  it("is overdue on the date axis and waiting on the state axis", () => {
    expect(bucketOf(overdueAndWaiting, NOW)).toBe("overdue");
    expect(stateOf(overdueAndWaiting)).toBe("waiting_on_others");
  });

  it("is found by either filter", () => {
    const items = [overdueAndWaiting];
    expect(filterWorkItems(items, { bucket: "overdue" }, NOW)).toHaveLength(1);
    expect(filterWorkItems(items, { bucket: "waiting_on_others" }, NOW)).toHaveLength(1);
  });

  it("is not counted as needing the operator", () => {
    // The point of the whole change: overdue does not mean it is on you.
    expect(filterWorkItems([overdueAndWaiting], { bucket: "needs_attention" }, NOW)).toHaveLength(0);
  });
});

describe("filterWorkItems across the full filter set", () => {
  const items: WorkItem[] = [
    item({ key: "decide:mine", due: day(-1) }),                                  // overdue, needs me
    item({ key: "decide:today", due: day(0) }),                                  // due today, needs me
    item({ key: "decide:later", due: day(5) }),                                  // remaining, needs me
    item({ key: "fix:stuck", blocker: "Analysis failed", due: day(2) }),         // blocked
    item({ key: "awaiting:rivera", waitingOn: { party: "Rivera" }, due: day(4) }), // waiting
  ];

  it("returns everything for all", () => {
    expect(filterWorkItems(items, { bucket: "all" }, NOW)).toHaveLength(5);
  });

  it("splits the state axis into three disjoint sets covering every item", () => {
    const needs = filterWorkItems(items, { bucket: "needs_attention" }, NOW);
    const blocked = filterWorkItems(items, { bucket: "blocked" }, NOW);
    const waiting = filterWorkItems(items, { bucket: "waiting_on_others" }, NOW);
    expect(needs).toHaveLength(3);
    expect(blocked).toHaveLength(1);
    expect(waiting).toHaveLength(1);
    expect(needs.length + blocked.length + waiting.length).toBe(items.length);
  });

  it("still splits the date axis the way it always did", () => {
    expect(filterWorkItems(items, { bucket: "overdue" }, NOW)).toHaveLength(1);
    expect(filterWorkItems(items, { bucket: "due_today" }, NOW)).toHaveLength(1);
    expect(filterWorkItems(items, { bucket: "remaining" }, NOW)).toHaveLength(3);
  });

  it("offers a label for every filter it offers", () => {
    // A tab with no label ships as the string "undefined".
    for (const f of QUEUE_FILTERS) {
      expect(QUEUE_FILTER_LABEL[f], `no label for ${f}`).toBeTruthy();
    }
  });
});

describe("taskFingerprint", () => {
  it("is the record, so the same work under two kinds is one task", () => {
    expect(taskFingerprint(item({ key: "fix_blocker:opp-1" }))).toBe("opp-1");
    expect(taskFingerprint(item({ key: "review_bid:opp-1" }))).toBe("opp-1");
    expect(taskFingerprint(item({ key: "fix_blocker:opp-1" }))).toBe(
      taskFingerprint(item({ key: "review_bid:opp-1" }))
    );
  });

  it("falls back to the whole key rather than returning nothing", () => {
    // An empty fingerprint would collapse unrelated rows into one.
    expect(taskFingerprint(item({ key: "standalone" }))).toBe("standalone");
    expect(taskFingerprint(item({ key: "trailing:" }))).toBe("trailing:");
  });
});
