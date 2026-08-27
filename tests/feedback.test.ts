/**
 * What a feedback form is allowed to carry away from somebody's screen.
 *
 * The rule: the product decides what it attaches, and the person decides
 * whether it attaches anything at all. A form that quietly ships the URL with
 * its query string eventually ships a customer's search terms, or a token, to
 * somebody who only wanted to say a button was confusing.
 */
import { describe, it, expect } from "vitest";
import {
  isFeedbackCategory,
  messageProblem,
  safeBrowser,
  safePage,
  sanitizeDiagnostics,
  categoryLabel,
  MESSAGE_MAX,
} from "@/lib/domain/feedback";

describe("safePage", () => {
  it("keeps the path and throws away everything after it", () => {
    expect(safePage("/opportunities?q=secret+search&token=abc")).toBe("/opportunities");
    expect(safePage("https://app.brostco.test/subs/123?filter=x#top")).toBe("/subs/123");
  });

  it("refuses anything that is not a path on this product", () => {
    expect(safePage("not a url")).toBeNull();
    expect(safePage("")).toBeNull();
    expect(safePage(null)).toBeNull();
    expect(safePage("javascript:alert(1)")).toBeNull();
  });

  it("bounds the length, so a pasted essay cannot become a page name", () => {
    expect(safePage(`/${"a".repeat(500)}`)!.length).toBe(200);
  });
});

describe("diagnostics are an allow-list", () => {
  it("keeps only the named fields", () => {
    const d = sanitizeDiagnostics({
      viewportWidth: 1440,
      timezone: "America/Boise",
      // None of these are on the list, and a deny-list would have to have
      // predicted each one.
      cookie: "brostco_session=abc",
      localStorage: { token: "sk-live-1234" },
      email: "somebody@example.com",
      url: "https://app.brostco.test/subs?q=secret",
    });
    expect(d).toEqual({ viewportWidth: 1440, timezone: "America/Boise" });
  });

  it("returns null rather than an empty object when nothing survives", () => {
    expect(sanitizeDiagnostics({ cookie: "x" })).toBeNull();
    expect(sanitizeDiagnostics(null)).toBeNull();
    expect(sanitizeDiagnostics("a string")).toBeNull();
  });

  it("bounds a string field so a payload cannot hide in one", () => {
    const d = sanitizeDiagnostics({ timezone: "x".repeat(500) });
    expect((d!.timezone as string).length).toBe(80);
  });

  it("drops a number that is not one", () => {
    expect(sanitizeDiagnostics({ viewportWidth: Number.NaN })).toBeNull();
  });
});

describe("the message", () => {
  it("refuses an empty or near-empty report", () => {
    expect(messageProblem("")).toMatch(/Say what happened/);
    expect(messageProblem("broken")).toMatch(/few more words/);
  });

  it("accepts a real one", () => {
    expect(messageProblem("The pipeline count on Today says 4 and the list has 3.")).toBeNull();
  });

  it("refuses one longer than the cap", () => {
    expect(messageProblem("x".repeat(MESSAGE_MAX + 1))).toMatch(/longer than/);
  });
});

describe("categories", () => {
  it("accepts only the five it defines", () => {
    expect(isFeedbackCategory("wrong_number")).toBe(true);
    expect(isFeedbackCategory("anything")).toBe(false);
  });

  it("gives a plain label rather than the stored key", () => {
    expect(categoryLabel("wrong_number")).toBe("A number looks wrong");
  });
});

describe("browser", () => {
  it("bounds the user agent and drops an empty one", () => {
    expect(safeBrowser("  ")).toBeNull();
    expect(safeBrowser("x".repeat(900))!.length).toBe(400);
  });
});
