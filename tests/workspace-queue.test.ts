import { describe, expect, it } from "vitest";
import {
  advanceTarget,
  queueHrefBuilder,
  queuePosition,
  resolveSelection,
} from "@/lib/domain/workspace-queue";

const IDS = ["a", "b", "c"];

describe("where you are in a queue", () => {
  it("counts from one for a person and from zero for the code", () => {
    const p = queuePosition(IDS, "b");
    expect(p.index).toBe(1);
    expect(p.total).toBe(3);
  });

  it("names both neighbours in the middle", () => {
    expect(queuePosition(IDS, "b")).toMatchObject({ prevId: "a", nextId: "c", last: false });
  });

  it("has no previous at the top and no next at the bottom", () => {
    expect(queuePosition(IDS, "a")).toMatchObject({ prevId: null, nextId: "b" });
    expect(queuePosition(IDS, "c")).toMatchObject({ prevId: "b", nextId: null, last: true });
  });

  it("reports nothing open rather than guessing", () => {
    expect(queuePosition(IDS, null)).toMatchObject({ index: -1, prevId: null, nextId: null });
  });

  it("treats an id that is not in the list as nothing open", () => {
    // A bookmark to a record somebody else finished. It must not resolve to a
    // neighbour of an item that is not there.
    expect(queuePosition(IDS, "gone")).toMatchObject({ index: -1, nextId: null });
  });

  it("survives an empty queue", () => {
    expect(queuePosition([], "a")).toMatchObject({ index: -1, total: 0, last: false });
  });
});

describe("what act-and-move-on lands on", () => {
  it("is the next row", () => {
    expect(advanceTarget(IDS, "a")).toBe("b");
  });

  it("is nothing on the last row, so the caller falls back to the list", () => {
    // Not the previous row: finishing the last item and being shown a row that
    // is already done reads as the action having failed.
    expect(advanceTarget(IDS, "c")).toBeNull();
  });

  it("is nothing when the queue holds one item", () => {
    expect(advanceTarget(["only"], "only")).toBeNull();
  });
});

describe("which item a page renders", () => {
  const items = [{ id: "a" }, { id: "b" }];
  const idOf = (i: { id: string }) => i.id;

  it("honours the URL when it names a real item", () => {
    expect(resolveSelection(items, idOf, "b")).toEqual({ id: "b" });
  });

  it("falls through to the first when the URL names nothing", () => {
    expect(resolveSelection(items, idOf, null)).toEqual({ id: "a" });
  });

  it("falls through to the first when the URL names a record that has gone", () => {
    expect(resolveSelection(items, idOf, "vanished")).toEqual({ id: "a" });
  });

  it("returns nothing for an empty queue rather than throwing", () => {
    expect(resolveSelection([], idOf, "a")).toBeNull();
  });
});

describe("queue links", () => {
  it("keeps every other parameter when the open item changes", () => {
    const { forItem } = queueHrefBuilder("/review", { filter: "urgent", q: "roof" }, "o");
    const href = forItem("42");
    expect(href.startsWith("/review?")).toBe(true);
    const p = new URLSearchParams(href.split("?")[1]);
    expect(p.get("filter")).toBe("urgent");
    expect(p.get("q")).toBe("roof");
    expect(p.get("o")).toBe("42");
  });

  it("replaces rather than appends the open item", () => {
    const { forItem } = queueHrefBuilder("/review", { o: "old" }, "o");
    const p = new URLSearchParams(forItem("new").split("?")[1]);
    expect(p.getAll("o")).toEqual(["new"]);
  });

  it("gives a clean base with nothing open", () => {
    expect(queueHrefBuilder("/review", {}, "o").base).toBe("/review");
    expect(queueHrefBuilder("/review", { o: "1" }, "o").base).toBe("/review");
  });

  it("keeps repeated parameters repeated", () => {
    const { base } = queueHrefBuilder("/subs", { tag: ["a", "b"] }, "peek");
    expect(new URLSearchParams(base.split("?")[1]).getAll("tag")).toEqual(["a", "b"]);
  });
});
