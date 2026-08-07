import { describe, it, expect } from "vitest";
import { extractMentionedPrice } from "@/lib/agents/maintenance";

describe("extractMentionedPrice", () => {
  it("finds a plain dollar amount", () => {
    expect(extractMentionedPrice("We can do it for $42,500 all-in.")).toBe(42500);
  });

  it("takes the largest plausible figure when several appear", () => {
    expect(
      extractMentionedPrice("Mobilization is $2,000 and the total would be $128,500.")
    ).toBe(128500);
  });

  it("handles cents and spaces after the dollar sign", () => {
    expect(extractMentionedPrice("Quote: $ 9,750.50 firm")).toBe(9750.5);
  });

  it("ignores implausibly small or huge figures", () => {
    expect(extractMentionedPrice("a $5 fee")).toBeNull();
    expect(extractMentionedPrice("$999,999,999,999 obviously junk")).toBeNull();
  });

  it("returns null when no dollar figure exists", () => {
    expect(extractMentionedPrice("Happy to take a look. Call me tomorrow.")).toBeNull();
  });
});
