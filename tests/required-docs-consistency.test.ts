import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { REQUIRED_FOR_AWARD } from "@/lib/domain/sub-compliance";
import { REQUIRED_DOC_SQL_TYPES } from "@/lib/data";

/**
 * The list of award-blocking documents exists twice: once as the domain
 * constant the compliance panel reasons over, and once inside the SQL that
 * counts them for the roster and the quick look. Two lists that must agree
 * and nothing forcing them to is how a fourth required document ends up
 * blocking awards while every list still reads "Ready".
 */
describe("required documents", () => {
  it("the SQL count and the compliance gate agree on which documents block an award", () => {
    expect([...REQUIRED_DOC_SQL_TYPES].sort()).toEqual([...REQUIRED_FOR_AWARD].sort());
  });

  it("the SQL fragment is used rather than being pasted in each query", () => {
    const src = readFileSync("lib/data.ts", "utf8");
    const inlined = src.match(/unnest\(array\['w9'/g) ?? [];
    expect(inlined.length).toBe(0);
    expect(src).toContain("unmetRequiredDocsSql");
  });
});
