import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { answerSentences } from "@/components/marketing/site-shell";

const pad = (sentence: string) => `${sentence} ${"detail ".repeat(40)}Then stop here.`;

describe("FAQ sentence splitter", () => {
  it("does not split SAM.gov, U.S., or decimals", () => {
    const parts = answerSentences(pad("Open SAM.gov for the U.S. notice at level 4.5 today."));
    expect(parts?.[0]).toContain("SAM.gov");
    expect(parts?.[0]).toContain("U.S. notice");
    expect(parts?.[0]).toContain("4.5");
    expect(parts?.some((part) => part === "gov" || part.startsWith("gov"))).toBe(false);
    expect(parts?.some((part) => /^S\./.test(part))).toBe(false);
    expect(parts?.some((part) => part.startsWith("5 "))).toBe(false);
  });

  it("leaves a short answer as one block", () => {
    expect(answerSentences("See SAM.gov. The U.S. limit is 4.5.")).toBeNull();
  });

  it("keys repeated sentences by index", () => {
    const source = readFileSync("components/marketing/site-shell.tsx", "utf8");
    expect(source).toMatch(/sentences\.map\(\(sentence, index\) =>/);
    expect(source).toContain("key={index}");
    expect(source).not.toContain("key={sentence}");
  });
});
