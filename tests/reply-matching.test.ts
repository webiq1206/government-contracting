import { describe, it, expect } from "vitest";
import {
  normalizeEmail,
  senderMatchesSub,
  senderTrust,
  shouldAutoSaveQuote,
  isDeclineIntent,
  shouldAutoDecline,
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

describe("senderTrust on a strong match", () => {
  it("trusts another mailbox on the same company domain", () => {
    expect(senderTrust({
      fromEmail: "dispatch@bulldogrooter.com",
      subEmail: "chris@bulldogrooter.com",
      strongMatch: true,
    })).toEqual({ verified: true, via: "domain" });
  });
  it("does not domain-trust without a strong conversation match", () => {
    expect(senderTrust({
      fromEmail: "dispatch@bulldogrooter.com",
      subEmail: "chris@bulldogrooter.com",
      strongMatch: false,
    }).verified).toBe(false);
  });
  it("keeps freemail exact-only", () => {
    expect(senderTrust({
      fromEmail: "dispatch@gmail.com",
      subEmail: "chris@gmail.com",
      strongMatch: true,
    }).verified).toBe(false);
    expect(senderTrust({
      fromEmail: "Chris@Yahoo.com",
      subEmail: "chris@yahoo.com",
      strongMatch: true,
    })).toEqual({ verified: true, via: "exact" });
  });
  it("trusts a stored alias even when the roster mailbox is freemail", () => {
    expect(senderTrust({
      fromEmail: "dispatch@bulldogrooter.com",
      subEmail: "chris@gmail.com",
      strongMatch: true,
      aliases: ["Dispatch@BulldogRooter.com"],
    })).toEqual({ verified: true, via: "alias" });
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

describe("shouldAutoDecline", () => {
  it("requires sender ownership and a decline intent", () => {
    expect(isDeclineIntent("cant_fulfill")).toBe(true);
    expect(
      shouldAutoDecline({ senderVerified: true, intent: "cant_fulfill" })
    ).toBe(true);
    expect(
      shouldAutoDecline({ senderVerified: false, intent: "decline" })
    ).toBe(false);
  });
});
