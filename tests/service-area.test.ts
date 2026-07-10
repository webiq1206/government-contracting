import { describe, it, expect } from "vitest";
import {
  isNationwideArea,
  serviceAreaStateCodes,
} from "@/lib/us-states";
import { serviceAreaFit } from "@/lib/domain/scoring";

describe("isNationwideArea", () => {
  it("detects nationwide phrasings", () => {
    for (const s of [
      "Nationwide (all US)",
      "All 50 states",
      "United States",
      "National",
      "CONUS",
    ]) {
      expect(isNationwideArea(s)).toBe(true);
    }
  });
  it("does not flag a specific state", () => {
    expect(isNationwideArea("Idaho")).toBe(false);
    expect(isNationwideArea("Washington")).toBe(false);
  });
});

describe("serviceAreaStateCodes", () => {
  it("returns null for nationwide or empty (no restriction)", () => {
    expect(serviceAreaStateCodes(["Nationwide (all US)", "Idaho"])).toBeNull();
    expect(serviceAreaStateCodes([])).toBeNull();
    expect(serviceAreaStateCodes(null)).toBeNull();
  });
  it("maps full names, codes, DC and territories to USPS codes", () => {
    const codes = serviceAreaStateCodes([
      "Idaho",
      "WA",
      "District of Columbia",
      "Puerto Rico",
    ]);
    expect(codes).not.toBeNull();
    expect([...codes!].sort()).toEqual(["DC", "ID", "PR", "WA"]);
  });
  it("ignores unrecognized entries", () => {
    expect(serviceAreaStateCodes(["Nowhereland"])).toBeNull();
  });
});

describe("serviceAreaFit", () => {
  const regional = ["Idaho", "Washington", "Oregon"];
  it("fits when the PoP state is served", () => {
    expect(serviceAreaFit("ID", regional)).toBe("fit");
    expect(serviceAreaFit("wa", regional)).toBe("fit");
  });
  it("mismatches when the PoP state is outside a regional company", () => {
    expect(serviceAreaFit("TX", regional)).toBe("mismatch");
  });
  it("is unknown for nationwide companies (never penalize)", () => {
    expect(serviceAreaFit("TX", ["Nationwide (all US)"])).toBe("unknown");
  });
  it("is unknown when the opportunity has no place of performance", () => {
    expect(serviceAreaFit(null, regional)).toBe("unknown");
    expect(serviceAreaFit("", regional)).toBe("unknown");
  });
});
