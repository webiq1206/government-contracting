import { describe, it, expect } from "vitest";
import {
  parseTokens,
  joinTokens,
  matchOptions,
  addToken,
  removeToken,
  type TokenOption,
} from "@/lib/domain/multiselect";

const NAICS: TokenOption[] = [
  { value: "561720", label: "561720 · Janitorial Services" },
  { value: "561730", label: "561730 · Landscaping Services" },
  { value: "561210", label: "561210 · Facilities Support Services" },
  { value: "238320", label: "238320 · Painting and Wall Covering Contractors" },
];

describe("token parsing", () => {
  it("splits and trims CSV, dropping blanks", () => {
    expect(parseTokens(" 561720 , ,561730 ")).toEqual(["561720", "561730"]);
  });
  it("round-trips through join", () => {
    expect(joinTokens(["a", "b"])).toBe("a, b");
  });
});

describe("matchOptions", () => {
  it("matches by keyword in the label", () => {
    expect(matchOptions(NAICS, "janitorial", []).map((o) => o.value)).toEqual(["561720"]);
  });
  it("matches by code", () => {
    expect(matchOptions(NAICS, "5617", []).map((o) => o.value)).toEqual(["561720", "561730"]);
  });
  it("is case-insensitive", () => {
    expect(matchOptions(NAICS, "LANDSCAP", []).map((o) => o.value)).toEqual(["561730"]);
  });
  it("excludes already-selected values", () => {
    const out = matchOptions(NAICS, "5617", ["561720"]).map((o) => o.value);
    expect(out).toEqual(["561730"]);
  });
  it("empty query returns the first unselected options up to the limit", () => {
    expect(matchOptions(NAICS, "", [], 2)).toHaveLength(2);
    expect(matchOptions(NAICS, "  ", ["561720"], 10).map((o) => o.value)).not.toContain("561720");
  });
  it("returns nothing when no option matches", () => {
    expect(matchOptions(NAICS, "xyz", [])).toEqual([]);
  });
});

describe("addToken / removeToken", () => {
  it("adds a new token", () => {
    expect(addToken(["561720"], "561730")).toEqual(["561720", "561730"]);
  });
  it("ignores duplicates case-insensitively", () => {
    expect(addToken(["Idaho"], "idaho")).toEqual(["Idaho"]);
  });
  it("ignores blank tokens", () => {
    expect(addToken(["a"], "   ")).toEqual(["a"]);
  });
  it("supports custom (non-option) values", () => {
    expect(addToken([], "Pacific Northwest")).toEqual(["Pacific Northwest"]);
  });
  it("removes a token case-insensitively", () => {
    expect(removeToken(["Idaho", "Washington"], "idaho")).toEqual(["Washington"]);
  });
});
