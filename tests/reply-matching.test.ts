import { describe, it, expect } from "vitest";
import {
  normalizeEmail,
  senderMatchesSub,
  shouldAutoSaveQuote,
} from "../lib/reply-matching";
import { regexPrice } from "../lib/ai/quote-extract";

describe("senderMatchesSub", () => {
  it("matches identical mailboxes case/space-insensitively", () => {
    expect(senderMatchesSub(" Mike@AlvarezElectric.com ", "mike@alvarezelectric.com")).toBe(true);
  });
  it("rejects a different sender in the same company", () => {
    expect(senderMatchesSub("estimator@alvarezelectric.com", "mike@alvarezelectric.com")).toBe(false);
  });
  it("rejects empty/missing emails", () => {
    expect(senderMatchesSub("", "mike@x.com")).toBe(false);
    expect(senderMatchesSub("mike@x.com", null)).toBe(false);
    expect(senderMatchesSub(null, null)).toBe(false);
  });
  it("normalizeEmail trims and lowercases", () => {
    expect(normalizeEmail("  A@B.Com ")).toBe("a@b.com");
  });
});

describe("shouldAutoSaveQuote", () => {
  const ok = { threadMatched: true, senderVerified: true, isQuote: true, quoteAmount: 148500 };
  it("allows only thread-matched, sender-verified, AI-confirmed quotes", () => {
    expect(shouldAutoSaveQuote(ok)).toBe(true);
  });
  it("never auto-saves on sender-only fallback matches (no thread match)", () => {
    expect(shouldAutoSaveQuote({ ...ok, threadMatched: false })).toBe(false);
  });
  it("never auto-saves when a different participant replies inside the thread", () => {
    expect(shouldAutoSaveQuote({ ...ok, senderVerified: false })).toBe(false);
  });
  it("never auto-saves when the AI did not confirm a quote (regex hint only)", () => {
    expect(shouldAutoSaveQuote({ ...ok, isQuote: false })).toBe(false);
  });
  it("never auto-saves without a positive amount", () => {
    expect(shouldAutoSaveQuote({ ...ok, quoteAmount: null })).toBe(false);
    expect(shouldAutoSaveQuote({ ...ok, quoteAmount: 0 })).toBe(false);
    expect(shouldAutoSaveQuote({ ...ok, quoteAmount: -5 })).toBe(false);
  });
});

describe("regexPrice fallback", () => {
  it("finds a dollar figure as a hint", () => {
    expect(regexPrice("we can do it for $148,500 net 30")).toBe(148500);
  });
  it("returns null when no price is present", () => {
    expect(regexPrice("thanks, we'll review and get back to you")).toBeNull();
  });
});
