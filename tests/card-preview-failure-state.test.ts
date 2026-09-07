import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("opportunity card preview failure state", () => {
  it("does not leave a failed preview displaying Loading forever", () => {
    const source = readFileSync("components/card-preview.tsx", "utf8");
    expect(source).toContain("if (!r.ok) throw new Error");
    expect(source).toContain("The preview did not load.");
    expect(source).toContain('role="alert"');
    expect(source).not.toContain(".catch(() => null)");
  });
});
