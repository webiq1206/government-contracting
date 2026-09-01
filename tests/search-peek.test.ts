import { describe, expect, it } from "vitest";
import {
  parsePeekParam,
  peekParam,
  peekTarget,
  type SearchResult,
} from "@/lib/domain/search-results";

const ID = "11111111-2222-4333-8444-555555555555";

function result(href: string): Pick<SearchResult, "href"> {
  return { href };
}

describe("which results can be read without leaving the search", () => {
  it("recognises an opportunity and a subcontractor", () => {
    expect(peekTarget(result(`/opportunity/${ID}`))).toEqual({
      kind: "opportunity",
      id: ID,
    });
    expect(peekTarget(result(`/subs/${ID}`))).toEqual({
      kind: "subcontractor",
      id: ID,
    });
  });

  it("still recognises one carrying a hash or a query", () => {
    // Document results point at the record with an anchor on it.
    expect(peekTarget(result(`/opportunity/${ID}#documents`))?.id).toBe(ID);
    expect(peekTarget(result(`/subs/${ID}?tab=notes`))?.id).toBe(ID);
  });

  it("refuses the three kinds with no single record behind them", () => {
    /*
     * A contract row points at the list, a message row at the conversation
     * centre, a document row at whatever record it hangs off. None of them is
     * one record, so offering a preview would be a control that opens nothing.
     */
    expect(peekTarget(result("/contracts"))).toBeNull();
    expect(peekTarget(result("/communications"))).toBeNull();
    expect(peekTarget(result("/pipeline"))).toBeNull();
  });

  it("refuses a search link that merely mentions an opportunity", () => {
    expect(
      peekTarget(result("/search?q=W912&kind=opportunity&all=1"))
    ).toBeNull();
  });

  it("refuses an id that is not a uuid", () => {
    expect(peekTarget(result("/opportunity/42"))).toBeNull();
    expect(peekTarget(result("/subs/../../etc/passwd"))).toBeNull();
  });
});

describe("the peek parameter", () => {
  it("round-trips", () => {
    const target = { kind: "opportunity" as const, id: ID };
    expect(parsePeekParam(peekParam(target))).toEqual(target);
  });

  it("refuses a kind it cannot render", () => {
    // Never guess. A parameter naming a kind with no loader behind it must
    // resolve to nothing rather than to the wrong drawer.
    expect(parsePeekParam(`contract:${ID}`)).toBeNull();
    expect(parsePeekParam(`document:${ID}`)).toBeNull();
  });

  it("refuses a malformed id rather than passing it to a query", () => {
    expect(parsePeekParam("opportunity:not-a-uuid")).toBeNull();
    expect(parsePeekParam("opportunity:")).toBeNull();
    expect(parsePeekParam(":x")).toBeNull();
    expect(parsePeekParam("opportunity")).toBeNull();
  });

  it("survives an absent or repeated parameter", () => {
    expect(parsePeekParam(undefined)).toBeNull();
    expect(parsePeekParam([`subcontractor:${ID}`, "junk"])).toEqual({
      kind: "subcontractor",
      id: ID,
    });
  });
});
