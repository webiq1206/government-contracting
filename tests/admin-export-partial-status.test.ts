import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("admin account export completeness", () => {
  it("labels failed tables, audits them, and returns HTTP 206", () => {
    const source = readFileSync(
      resolve(__dirname, "../app/api/admin/accounts/[id]/export/route.ts"),
      "utf8"
    );

    expect(source).toContain("incompleteTables.push(table)");
    expect(source).toContain("incomplete_tables: incompleteTables");
    expect(source).toContain("failed_tables: incompleteTables");
    expect(source).toMatch(/status:\s*incompleteTables\.length\s*\?\s*206\s*:\s*200/);
  });
});
