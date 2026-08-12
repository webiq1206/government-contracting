import { describe, it, expect } from "vitest";
import {
  isListTokenLine,
  toggleBulletLines,
  wrapHighlightLines,
  wrapSelection,
} from "../lib/domain/template-markup";

describe("isListTokenLine", () => {
  it("matches a bare questions token", () => {
    expect(isListTokenLine("{{questions}}")).toBe(true);
    expect(isListTokenLine("  {{ questions }}  ")).toBe(true);
  });

  it("does not match ordinary lines", () => {
    expect(isListTokenLine("What we need you to price:")).toBe(false);
    expect(isListTokenLine("- {{questions}} extra")).toBe(false);
  });
});

describe("wrapHighlightLines", () => {
  it("wraps a same-line phrase", () => {
    const { next } = wrapHighlightLines("Please reply soon.", 7, 12);
    expect(next).toBe("Please ==reply== soon.");
  });

  it("wraps each selected line independently", () => {
    const src = "Line one\nLine two";
    const { next } = wrapHighlightLines(src, 0, src.length);
    expect(next).toBe("==Line one==\n==Line two==");
    expect(next.split("\n").every((l) => l.startsWith("==") && l.endsWith("=="))).toBe(
      true
    );
  });

  it("does not wrap a {{questions}} line", () => {
    const src = "Intro\n{{questions}}\nThanks";
    const { next } = wrapHighlightLines(src, 0, src.length);
    expect(next).toContain("{{questions}}");
    expect(next).not.toContain("=={{questions}}==");
    expect(next).toContain("==Intro==");
  });
});

describe("toggleBulletLines", () => {
  it("prefixes selected lines with a dash", () => {
    const src = "First\nSecond";
    const { next } = toggleBulletLines(src, 0, src.length);
    expect(next).toBe("- First\n- Second");
  });

  it("does not prefix {{questions}}", () => {
    const src = "{{questions}}";
    const { next } = toggleBulletLines(src, 0, src.length);
    expect(next).toBe("{{questions}}");
  });
});

describe("wrapSelection", () => {
  it("wraps bold markers around a phrase", () => {
    const { next } = wrapSelection("Hello world", 6, 11, "**", "**");
    expect(next).toBe("Hello **world**");
  });
});
