import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dedupeWorkItems, sortWorkItems, type WorkItem } from "@/lib/domain/work-queue";

/**
 * The one list of work has one destination.
 *
 * Every row used to lead somewhere different: an anchor on Today for a reply,
 * the call queue for a call, one of four anchors on the record page for the
 * rest. Six kinds of work, six layouts, six hunts for the control that
 * finishes the thing. The row now opens the workbench on that exact item, and
 * the per-kind deep link survives as `recordHref` so nothing lost the ability
 * to open the whole record.
 */
const DATA = readFileSync("lib/data.ts", "utf8");

function item(over: Partial<WorkItem>): WorkItem {
  return {
    key: over.key ?? "call:1",
    kind: "call",
    title: "Call someone",
    context: "Some job",
    href: "/workbench?i=call%3A1",
    recordHref: "/call-queue?open=1",
    actionLabel: "Call",
    ...over,
  };
}

describe("where a queue row goes", () => {
  it("is the workbench, opened on the item itself", () => {
    expect(DATA).toContain("href: `/workbench?i=${encodeURIComponent(item.key)}`");
  });

  it("keeps a per-kind link to the whole record", () => {
    // Five kinds, five record destinations, none of them lost.
    for (const fragment of [
      'recordHref: "/today#reply-reviews"',
      "recordHref: `/opportunity/${d.id}#next`",
      "recordHref: `/call-queue?open=${c.id}`",
      "recordHref: `/opportunity/${w.opp_id}`",
    ]) {
      expect(DATA).toContain(fragment);
    }
  });

  it("names the record behind every kind of task", () => {
    for (const fragment of [
      'record: { kind: "reply" as const, id: r.id }',
      'record: { kind: "opportunity" as const, id: d.id }',
      'record: { kind: "call_card" as const, id: c.id }',
      'record: { kind: "opportunity" as const, id: o.id }',
      'record: { kind: "pairing" as const, id: w.id }',
    ]) {
      expect(DATA).toContain(fragment);
    }
  });
});

describe("the queue keeps its shape once rows carry records", () => {
  it("still collapses two views of one record into one row", () => {
    const rows = dedupeWorkItems([
      item({ key: "act:opp-1", kind: "review_bid", record: { kind: "opportunity", id: "opp-1" } }),
      item({ key: "decide:opp-1", kind: "decide", record: { kind: "opportunity", id: "opp-1" } }),
    ]);
    expect(rows).toHaveLength(1);
    // The one whose action resolves the pair: bids outrank decisions.
    expect(rows[0].kind).toBe("review_bid");
  });

  it("still orders by how close the work is to a submitted bid", () => {
    const sorted = sortWorkItems([
      item({ key: "d", kind: "decide" }),
      item({ key: "b", kind: "review_bid" }),
      item({ key: "r", kind: "read_reply" }),
    ]);
    expect(sorted.map((i) => i.key)).toEqual(["r", "b", "d"]);
  });
});
