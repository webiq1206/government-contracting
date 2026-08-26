import { describe, it, expect } from "vitest";
import {
  groupResults,
  highlight,
  snippet,
  noResultAdvice,
  KIND_ORDER,
  KIND_PLURAL,
  type SearchResult,
} from "@/lib/domain/search-results";

function r(kind: SearchResult["kind"], title: string): SearchResult {
  return { kind, title, subtitle: "", href: `/${kind}/1` };
}

describe("groupResults", () => {
  it("names the five groups the audit asks for", () => {
    expect(KIND_ORDER).toEqual([
      "opportunity",
      "subcontractor",
      "contract",
      "communication",
      "document",
    ]);
    expect(KIND_PLURAL.communication).toBe("Messages");
  });

  it("keeps the groups in a fixed order whatever order the results arrive in", () => {
    const groups = groupResults([
      r("document", "Scope.pdf"),
      r("opportunity", "Roof replacement"),
      r("communication", "Re: quote"),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(["opportunity", "communication", "document"]);
  });

  it("drops empty groups rather than showing a heading with nothing under it", () => {
    expect(groupResults([r("opportunity", "A")]).map((g) => g.kind)).toEqual(["opportunity"]);
  });

  it("returns nothing for nothing", () => {
    expect(groupResults([])).toEqual([]);
  });
});

describe("highlight", () => {
  it("splits around every match, case-insensitively", () => {
    expect(highlight("Roof and roofing", "roof")).toEqual([
      { text: "Roof", match: true },
      { text: " and ", match: false },
      { text: "roof", match: true },
      { text: "ing", match: false },
    ]);
  });

  it("returns segments rather than markup, so nothing needs escaping", () => {
    // The text is a customer's own record, and this is the one path every
    // record in the account passes through.
    const segs = highlight('<img src=x onerror="alert(1)">', "img");
    expect(segs.every((s) => typeof s.text === "string")).toBe(true);
    expect(segs.map((s) => s.text).join("")).toBe('<img src=x onerror="alert(1)">');
  });

  it("leaves the string whole when nothing matches", () => {
    expect(highlight("Roof", "gutter")).toEqual([{ text: "Roof", match: false }]);
  });

  it("handles an empty query and empty text without looping", () => {
    expect(highlight("Roof", "")).toEqual([{ text: "Roof", match: false }]);
    expect(highlight("", "roof")).toEqual([{ text: "", match: false }]);
    expect(highlight("Roof", "   ")).toEqual([{ text: "Roof", match: false }]);
  });

  it("reassembles to exactly the original text", () => {
    const text = "Meridian ID roof, roofing, ROOFS";
    expect(highlight(text, "roof").map((s) => s.text).join("")).toBe(text);
  });
});

describe("snippet", () => {
  const body = `${"x".repeat(200)} the quote is attached ${"y".repeat(200)}`;

  it("windows a long body around the match", () => {
    const s = snippet(body, "quote", 20);
    expect(s).toContain("quote");
    expect(s.startsWith("…")).toBe(true);
    expect(s.endsWith("…")).toBe(true);
    expect(s.length).toBeLessThan(body.length);
  });

  it("does not mark an ellipsis where the text simply starts or ends", () => {
    const s = snippet("quote attached", "quote", 40);
    expect(s).toBe("quote attached");
  });

  it("falls back to the opening when the query is not in the body", () => {
    expect(snippet("hello there", "absent", 40)).toBe("hello there");
  });

  it("marks the opening as truncated rather than cutting it silently", () => {
    expect(snippet("hello there", "absent", 5)).toBe("hello ther…");
    expect(snippet("hello there", "", 5)).toBe("hello ther…");
  });

  it("collapses runs of whitespace, so a wrapped email does not render as gaps", () => {
    expect(snippet("a\n\n  b\tc", "b", 10)).toBe("a b c");
  });
});

describe("noResultAdvice", () => {
  it("always says what is actually searched, because that is the real answer", () => {
    const a = noResultAdvice("something");
    expect(a[a.length - 1]).toContain("document names");
  });

  it("suggests lengthening a very short search", () => {
    expect(noResultAdvice("ab").some((s) => s.includes("more of the word"))).toBe(true);
  });

  it("suggests dropping a prefix from a solicitation number", () => {
    expect(noResultAdvice("W912-4471").some((s) => s.includes("solicitation number"))).toBe(true);
  });

  it("explains that an email address finds the firm, not the message", () => {
    expect(noResultAdvice("sub@example.com").some((s) => s.includes("company name"))).toBe(true);
  });

  it("suggests one word instead of a phrase", () => {
    expect(noResultAdvice("roof replacement meridian").some((s) => s.includes("one distinctive word"))).toBe(
      true
    );
  });
});
