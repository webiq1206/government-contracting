import { describe, expect, it } from "vitest";
import {
  QUEUE_FILTERS,
  QUEUE_FILTER_LABEL,
  filterWorkItems,
  isCompletedFilter,
  parseQueueFilter,
  type WorkItem,
} from "../lib/domain/work-queue";

/**
 * "Completed today" as a filter on the one list, rather than a jump link to a
 * total.
 *
 * The counter answers how much. The question somebody actually has at five
 * o'clock is what, and a count of six cannot be checked against memory the way
 * a list of the six can.
 *
 * It is also the one filter this queue cannot serve, because the queue holds
 * what is LEFT. That is a fact about where the data lives, not a reason to
 * leave the filter off the page.
 */

const ITEM: WorkItem = {
  key: "a",
  kind: "call",
  title: "Call Rivera Mechanical",
  context: "Fort Bliss HVAC",
  href: "/x",
  actionLabel: "Open",
};

describe("the filter list", () => {
  it("includes all six the brief names", () => {
    for (const f of [
      "needs_attention",
      "overdue",
      "due_today",
      "waiting_on_others",
      "blocked",
      "completed_today",
    ]) {
      expect(QUEUE_FILTERS as readonly string[]).toContain(f);
    }
  });

  it("labels the new one in the same words as the counter", () => {
    expect(QUEUE_FILTER_LABEL.completed_today).toBe("Completed today");
  });

  it("survives a round trip through the URL", () => {
    expect(parseQueueFilter("completed_today")).toBe("completed_today");
    expect(isCompletedFilter(parseQueueFilter("completed_today"))).toBe(true);
    expect(isCompletedFilter(parseQueueFilter("overdue"))).toBe(false);
  });
});

describe("what the queue does when asked for it", () => {
  it("refuses, rather than returning an empty list", () => {
    /*
     * Falling through would return [], and [] here looks exactly like a day on
     * which nothing was finished: the wrong answer, delivered confidently.
     * This is the same rule as never printing 0 for an unknown count, applied
     * to a list instead of a number.
     */
    expect(() => filterWorkItems([ITEM], { bucket: "completed_today" })).toThrow(/ledger/);
  });

  it("still answers every filter that is a cut of it", () => {
    expect(filterWorkItems([ITEM], { bucket: "needs_attention" })).toHaveLength(1);
    expect(filterWorkItems([ITEM], { bucket: "blocked" })).toHaveLength(0);
    expect(filterWorkItems([ITEM], { bucket: "all" })).toHaveLength(1);
  });
});
