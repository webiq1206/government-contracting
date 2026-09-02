/**
 * The four numbers Today leads with, and filtering by them.
 *
 * The one that matters most: an item with no deadline is `remaining`, never
 * `overdue`. Treating an absent date as a passed one is the same lie as
 * showing 0 for an unknown count, and here it would fill the overdue counter
 * with work that is not late and has no way of becoming late.
 */
import { describe, it, expect } from "vitest";
import {
  bucketOf,
  queueCounts,
  filterWorkItems,
  parseQueueFilter,
  parseKindFilter,
  needsYou,
  needsYouCount,
  QUEUE_FILTERS,
  QUEUE_FILTER_LABEL,
  KIND_FILTER_LABEL,
  type WorkItem,
} from "@/lib/domain/work-queue";

const NOW = new Date("2026-08-26T14:00:00Z");
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000).toISOString();

function item(over: Partial<WorkItem> & { key: string }): WorkItem {
  return {
    kind: "call",
    title: "Call Rivera Mechanical about HVAC",
    context: "Base electrical upgrade",
    href: "/call-queue",
    actionLabel: "Open",
    ...over,
  };
}

describe("bucketOf", () => {
  it("never calls an undated item overdue", () => {
    expect(bucketOf(item({ key: "a" }), NOW)).toBe("remaining");
    expect(bucketOf(item({ key: "b", due: null }), NOW)).toBe("remaining");
  });

  it("treats an unparseable date as undated rather than as the epoch", () => {
    /*
     * `new Date("soon")` is NaN, and NaN < start is false in one direction
     * and true in another depending on how it is written. Pinned so a bad
     * string cannot quietly land in the overdue counter.
     */
    expect(bucketOf(item({ key: "c", due: "soon" }), NOW)).toBe("remaining");
  });

  it("splits by the local day, not by the hour", () => {
    expect(bucketOf(item({ key: "d", due: hours(-30) }), NOW)).toBe("overdue");
    expect(bucketOf(item({ key: "e", due: hours(-2) }), NOW)).toBe("due_today");
    expect(bucketOf(item({ key: "f", due: hours(2) }), NOW)).toBe("due_today");
    expect(bucketOf(item({ key: "g", due: hours(40) }), NOW)).toBe("remaining");
  });
});

describe("queueCounts", () => {
  it("puts every item in exactly one bucket", () => {
    const items = [
      item({ key: "1", due: hours(-30) }),
      item({ key: "2", due: hours(-30) }),
      item({ key: "3", due: hours(1) }),
      item({ key: "4", due: hours(48) }),
      item({ key: "5" }),
    ];
    const c = queueCounts(items, NOW);
    expect(c).toEqual({ overdue: 2, dueToday: 1, remaining: 2, total: 5 });
    expect(c.overdue + c.dueToday + c.remaining).toBe(c.total);
  });

  it("is all zeroes on an empty queue, which is a real answer", () => {
    expect(queueCounts([], NOW)).toEqual({ overdue: 0, dueToday: 0, remaining: 0, total: 0 });
  });
});

describe("needsYou", () => {
  it("does not count work that is waiting on somebody else", () => {
    const items = [
      item({ key: "call:1" }),
      item({
        key: "awaiting:2",
        title: "Waiting on Rivera Mechanical",
        waitingOn: { party: "Rivera Mechanical" },
      }),
    ];
    expect(needsYou(items)).toHaveLength(1);
    expect(needsYouCount(items)).toBe(1);
    const c = queueCounts(needsYou(items), NOW);
    expect(c.overdue + c.dueToday + c.remaining).toBe(c.total);
    expect(c.total).toBe(1);
  });

  it("keeps blocked work, because that still needs a person", () => {
    const items = [
      item({ key: "act:1", blocker: "Claude could not read the packet" }),
    ];
    expect(needsYouCount(items)).toBe(1);
  });
});

describe("filterWorkItems", () => {
  const items = [
    item({ key: "1", kind: "call", due: hours(-30), title: "Call Rivera Mechanical" }),
    item({ key: "2", kind: "decide", due: hours(1), title: "Decide on base paving" }),
    item({ key: "3", kind: "call", title: "Call Acme Electric", reason: "no reply in 6 days" }),
  ];

  it("filters by bucket", () => {
    expect(filterWorkItems(items, { bucket: "overdue" }, NOW).map((i) => i.key)).toEqual(["1"]);
    expect(filterWorkItems(items, { bucket: "due_today" }, NOW).map((i) => i.key)).toEqual(["2"]);
    expect(filterWorkItems(items, { bucket: "remaining" }, NOW).map((i) => i.key)).toEqual(["3"]);
    expect(filterWorkItems(items, { bucket: "all" }, NOW)).toHaveLength(3);
  });

  it("filters by kind", () => {
    expect(filterWorkItems(items, { kind: "call" }, NOW).map((i) => i.key)).toEqual(["1", "3"]);
  });

  it("searches the reason as well as the title", () => {
    /*
     * Somebody typing a subcontractor's name is as likely to be thinking of
     * the one named in the reason as the one in the ask.
     */
    expect(filterWorkItems(items, { q: "no reply" }, NOW).map((i) => i.key)).toEqual(["3"]);
    expect(filterWorkItems(items, { q: "rivera" }, NOW).map((i) => i.key)).toEqual(["1"]);
  });

  it("combines filters rather than widening on the second one", () => {
    expect(filterWorkItems(items, { kind: "call", bucket: "overdue" }, NOW).map((i) => i.key)).toEqual(["1"]);
  });
});

describe("filter parsing", () => {
  it("falls open to everything on a bad value", () => {
    expect(parseQueueFilter("nonsense")).toBe("all");
    expect(parseQueueFilter(undefined)).toBe("all");
    expect(parseKindFilter("nonsense")).toBeNull();
    expect(parseKindFilter(undefined)).toBeNull();
  });

  it("reads a good one, including a repeated parameter", () => {
    expect(parseQueueFilter("overdue")).toBe("overdue");
    expect(parseQueueFilter(["due_today", "overdue"])).toBe("due_today");
    expect(parseKindFilter("read_reply")).toBe("read_reply");
  });

  it("labels every filter and every kind", () => {
    for (const f of QUEUE_FILTERS) expect(QUEUE_FILTER_LABEL[f]).toBeTruthy();
    for (const k of Object.keys(KIND_FILTER_LABEL)) {
      expect(KIND_FILTER_LABEL[k as keyof typeof KIND_FILTER_LABEL]).toBeTruthy();
    }
  });
});
