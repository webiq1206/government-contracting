import { describe, it, expect } from "vitest";
import { termTip } from "@/lib/domain/glossary";

describe("glossary termTip", () => {
  it("explains core contracting terms in plain English", () => {
    expect(termTip("uei")).toMatch(/SAM\.gov/i);
    expect(termTip("cage")).toMatch(/five-character/i);
    expect(termTip("naics")).toMatch(/industry/i);
    expect(termTip("set_aside")).toMatch(/allowed to bid/i);
    expect(termTip("score")).toMatch(/0–100|0-100|Higher is better/i);
  });

  it("returns undefined for unknown keys", () => {
    expect(termTip("not_a_real_term")).toBeUndefined();
  });
});
