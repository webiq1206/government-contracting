import { describe, it, expect } from "vitest";
import { tagOverlap, rankContent, parseContentBody } from "@/lib/domain/content";
import type { ContentLibraryItem } from "@/lib/types";

let seq = 0;
function item(p: Partial<ContentLibraryItem> & { title: string }): ContentLibraryItem {
  seq += 1;
  return {
    id: `id-${seq}`,
    title: p.title,
    category: p.category ?? "past_performance",
    body: p.body ?? "body",
    tags: p.tags ?? [],
    is_active: p.is_active ?? true,
    created_at: p.created_at ?? "2026-01-01T00:00:00Z",
    updated_at: p.updated_at ?? "2026-01-01T00:00:00Z",
  };
}

describe("tagOverlap", () => {
  it("counts case-insensitive matches", () => {
    expect(tagOverlap(["HVAC", "Roofing"], ["hvac", "electrical"])).toBe(1);
    expect(tagOverlap(["hvac", "roofing"], ["HVAC", "ROOFING"])).toBe(2);
  });

  it("is zero when either side is empty", () => {
    expect(tagOverlap([], ["hvac"])).toBe(0);
    expect(tagOverlap(["hvac"], [])).toBe(0);
  });
});

describe("rankContent", () => {
  it("drops snippets with no tag overlap", () => {
    const items = [
      item({ title: "A", tags: ["hvac"] }),
      item({ title: "B", tags: ["landscaping"] }),
    ];
    const out = rankContent(items, ["hvac"], 3);
    expect(out.map((i) => i.title)).toEqual(["A"]);
  });

  it("ranks higher overlap first", () => {
    const items = [
      item({ title: "one-match", tags: ["hvac"] }),
      item({ title: "two-match", tags: ["hvac", "va"] }),
    ];
    const out = rankContent(items, ["hvac", "va"], 3);
    expect(out.map((i) => i.title)).toEqual(["two-match", "one-match"]);
  });

  it("breaks ties by most recently updated", () => {
    const items = [
      item({ title: "older", tags: ["hvac"], updated_at: "2026-01-01T00:00:00Z" }),
      item({ title: "newer", tags: ["hvac"], updated_at: "2026-06-01T00:00:00Z" }),
    ];
    const out = rankContent(items, ["hvac"], 3);
    expect(out.map((i) => i.title)).toEqual(["newer", "older"]);
  });

  it("never exceeds the limit", () => {
    const items = [
      item({ title: "A", tags: ["x"] }),
      item({ title: "B", tags: ["x"] }),
      item({ title: "C", tags: ["x"] }),
    ];
    expect(rankContent(items, ["x"], 2)).toHaveLength(2);
  });

  it("ignores inactive snippets", () => {
    const items = [
      item({ title: "off", tags: ["hvac"], is_active: false }),
      item({ title: "on", tags: ["hvac"], is_active: true }),
    ];
    expect(rankContent(items, ["hvac"]).map((i) => i.title)).toEqual(["on"]);
  });

  it("with no wanted tags, returns most recent active items", () => {
    const items = [
      item({ title: "old", updated_at: "2026-01-01T00:00:00Z" }),
      item({ title: "new", updated_at: "2026-09-01T00:00:00Z" }),
    ];
    const out = rankContent(items, [], 1);
    expect(out.map((i) => i.title)).toEqual(["new"]);
  });
});

describe("parseContentBody", () => {
  const good = { title: "T", category: "capability", body: "B", tags: ["HVAC", " va "] };

  it("accepts a valid payload and normalizes/dedupes tags", () => {
    const r = parseContentBody({ ...good, tags: ["HVAC", "hvac", " va "] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.title).toBe("T");
      expect(r.value.category).toBe("capability");
      expect(r.value.tags).toEqual(["hvac", "va"]);
    }
  });

  it("rejects a missing title", () => {
    expect(parseContentBody({ ...good, title: "  " }).ok).toBe(false);
  });

  it("rejects a missing body", () => {
    expect(parseContentBody({ ...good, body: "" }).ok).toBe(false);
  });

  it("rejects an unknown category", () => {
    expect(parseContentBody({ ...good, category: "nonsense" }).ok).toBe(false);
  });

  it("rejects a non-object", () => {
    expect(parseContentBody(null).ok).toBe(false);
    expect(parseContentBody("x").ok).toBe(false);
  });

  it("tolerates missing tags (defaults to empty)", () => {
    const r = parseContentBody({ title: "T", category: "boilerplate", body: "B" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.tags).toEqual([]);
  });
});
