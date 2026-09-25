import { describe, expect, it } from "vitest";
import { clipText } from "@/lib/domain/clip";

describe("clipText", () => {
  it("leaves a short sentence alone and collapses its whitespace", () => {
    expect(clipText("  two   words ")).toBe("two words");
    expect(clipText("")).toBeUndefined();
    expect(clipText(null)).toBeUndefined();
  });

  it("clips at a word and says so, never mid-word", () => {
    const text =
      "API_BUDGET: This service needs a price ceiling before a dollar limit can protect your spending. Ask the platform administrator to set one, or use a request-count limit. New paid work has stopped to protect your budget. Open Settings, API Usage to review limits or resume work.";
    const clipped = clipText(text, 200)!;
    expect(clipped.endsWith("...")).toBe(true);
    expect(clipped.length).toBeLessThanOrEqual(203);
    const kept = clipped.slice(0, -3);
    // Every word kept is a whole word from the original.
    expect(text.startsWith(kept)).toBe(true);
    expect(text.charAt(kept.length)).toMatch(/[\s,;:]/);
    expect(clipped).not.toMatch(/or res\.\.\.$/);
  });

  it("does not throw away most of the text to find a space", () => {
    const noSpaces = "x".repeat(300);
    expect(clipText(noSpaces, 100)!.length).toBe(102);
  });
});
