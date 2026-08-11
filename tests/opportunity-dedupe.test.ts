import { describe, it, expect } from "vitest";
import {
  normalizeSourceId,
  normalizeSolicitationNumber,
  solicitationNumberKey,
  preferDedupeMatch,
} from "../lib/domain/opportunity-dedupe";

describe("normalizeSourceId", () => {
  it("trims and rejects blanks", () => {
    expect(normalizeSourceId("  abc  ")).toBe("abc");
    expect(normalizeSourceId("")).toBeNull();
    expect(normalizeSourceId("   ")).toBeNull();
    expect(normalizeSourceId(null)).toBeNull();
  });
});

describe("normalizeSolicitationNumber / key", () => {
  it("normalizes blanks to null", () => {
    expect(normalizeSolicitationNumber("  W912-ABC  ")).toBe("W912-ABC");
    expect(normalizeSolicitationNumber("")).toBeNull();
    expect(normalizeSolicitationNumber(null)).toBeNull();
  });

  it("builds a case-insensitive compare key", () => {
    expect(solicitationNumberKey(" W912-Abc ")).toBe("w912-abc");
    expect(solicitationNumberKey("")).toBeNull();
  });
});

describe("preferDedupeMatch", () => {
  it("prefers source_id over solicitation_number", () => {
    expect(
      preferDedupeMatch({
        bySourceId: { id: "a" },
        bySolicitationNumber: { id: "b" },
      })
    ).toEqual({ id: "a", reason: "source_id" });
  });

  it("falls back to solicitation_number", () => {
    expect(
      preferDedupeMatch({
        bySourceId: null,
        bySolicitationNumber: { id: "b" },
      })
    ).toEqual({ id: "b", reason: "solicitation_number" });
  });

  it("returns null when nothing matches", () => {
    expect(
      preferDedupeMatch({ bySourceId: null, bySolicitationNumber: null })
    ).toBeNull();
  });
});
