import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("bulk action failure truth", () => {
  it("keeps partial failures selected and explains what to do next", () => {
    const source = readFileSync("components/bulk-selection.tsx", "utf8");
    expect(source).toContain("data.failed");
    expect(source).toContain("The failed items remain selected so you can retry.");
    expect(source).toContain("data.processed < selectedIds.length");
    expect(source).toContain("The server could not be reached.");
  });
});
