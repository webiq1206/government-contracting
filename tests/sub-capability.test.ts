import { describe, expect, it } from "vitest";
import {
  bondCovers,
  capabilityGaps,
  certificationLabel,
  countLabel,
  coversState,
  fitsProjectSize,
  CERTIFICATIONS,
  CONTACT_ROLES,
  CONTACT_ROLE_LABEL,
  NOT_ON_FILE,
  PREFERRED_CONTACT,
  PREFERRED_CONTACT_LABEL,
  SOURCE_CONFIDENCE,
  SOURCE_CONFIDENCE_HINT,
  SOURCE_CONFIDENCE_LABEL,
  type CapabilityFacts,
} from "@/lib/domain/sub-capability";

describe("three answers, not two", () => {
  /*
   * The rule the whole module turns on. A firm that has never been asked has
   * not said no, and a bid built by excluding everyone who has not filled in a
   * form is a bid with two quotes.
   */
  it("returns null for a project size nobody has ever stated", () => {
    expect(fitsProjectSize({}, 50_000_00)).toBeNull();
  });

  it("answers once either end is known", () => {
    expect(fitsProjectSize({ minProjectCents: 25_000_00 }, 10_000_00)).toBe(false);
    expect(fitsProjectSize({ minProjectCents: 25_000_00 }, 90_000_00)).toBe(true);
    expect(fitsProjectSize({ maxProjectCents: 80_000_00 }, 90_000_00)).toBe(false);
    expect(fitsProjectSize({ minProjectCents: 0, maxProjectCents: 80_000_00 }, 0)).toBe(true);
  });

  it("returns null for a service area nobody has recorded, either way round", () => {
    expect(coversState({}, "TX")).toBeNull();
    expect(coversState({ serviceAreaStates: [] }, "TX")).toBeNull();
    // Knowing the firm's states does not help when the job has no state.
    expect(coversState({ serviceAreaStates: ["TX"] }, null)).toBeNull();
  });

  it("matches a state without caring about case", () => {
    expect(coversState({ serviceAreaStates: ["tx", "NM"] }, "TX")).toBe(true);
    expect(coversState({ serviceAreaStates: ["TX"] }, "az")).toBe(false);
  });

  it("says no to an unbonded firm and null to one nobody has asked", () => {
    expect(bondCovers({ bonded: false }, 100_00)).toBe(false);
    expect(bondCovers({ bonded: true }, 100_00)).toBeNull();
    expect(bondCovers({}, 100_00)).toBeNull();
    expect(bondCovers({ bonded: true, bondSingleCents: 500_000_00 }, 400_000_00)).toBe(true);
    expect(bondCovers({ bonded: true, bondSingleCents: 500_000_00 }, 600_000_00)).toBe(false);
  });
});

describe("capability gaps", () => {
  it("names every unanswered question on an empty record", () => {
    expect(capabilityGaps({})).toEqual([
      "serviceArea",
      "capacity",
      "projectSize",
      "bonding",
      "certifications",
      "terms",
    ]);
  });

  it("counts a free-text service area as an answer, because it is one", () => {
    expect(capabilityGaps({ serviceAreaNote: "El Paso county and 50 miles either side" })).not.toContain(
      "serviceArea"
    );
    // Whitespace is not an answer.
    expect(capabilityGaps({ serviceAreaNote: "   " })).toContain("serviceArea");
  });

  it("takes either half of a two-part question as answered", () => {
    expect(capabilityGaps({ crewSize: 8 })).not.toContain("capacity");
    expect(capabilityGaps({ concurrentJobs: 2 })).not.toContain("capacity");
    expect(capabilityGaps({ quoteValidityDays: 30 })).not.toContain("terms");
  });

  it("treats bonded false as an answer: a firm that is not bonded has told us something", () => {
    expect(capabilityGaps({ bonded: false })).not.toContain("bonding");
  });

  it("returns nothing to ask once the record is complete", () => {
    const full: CapabilityFacts = {
      serviceAreaStates: ["TX"],
      crewSize: 8,
      minProjectCents: 25_000_00,
      bonded: true,
      certifications: ["hubzone"],
      paymentTerms: "Net 30",
    };
    expect(capabilityGaps(full)).toEqual([]);
  });
});

describe("labels", () => {
  it("never prints a bare zero or a dash for a missing value", () => {
    expect(countLabel(null, "person", "people")).toBe(NOT_ON_FILE);
    expect(countLabel(undefined, "person", "people")).toBe(NOT_ON_FILE);
    // A real zero is still printed, because zero is an answer when stated.
    expect(countLabel(0, "person", "people")).toBe("0 people");
    expect(countLabel(1, "person", "people")).toBe("1 person");
  });

  it("has a label for every role, contact method and confidence level", () => {
    for (const r of CONTACT_ROLES) expect(CONTACT_ROLE_LABEL[r]).toBeTruthy();
    for (const c of PREFERRED_CONTACT) expect(PREFERRED_CONTACT_LABEL[c]).toBeTruthy();
    for (const s of SOURCE_CONFIDENCE) {
      expect(SOURCE_CONFIDENCE_LABEL[s]).toBeTruthy();
      expect(SOURCE_CONFIDENCE_HINT[s]).toBeTruthy();
    }
  });

  it("falls back to the stored value rather than dropping an unknown certification", () => {
    expect(certificationLabel("hubzone")).toBe("HUBZone");
    // A value from an older record still shows as something rather than blank.
    expect(certificationLabel("ancient-program")).toBe("ancient-program");
  });

  it("keeps the certification keys unique", () => {
    const keys = CERTIFICATIONS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("orders source confidence weakest to strongest, so a comparison is a comparison", () => {
    expect(SOURCE_CONFIDENCE.indexOf("inferred")).toBeLessThan(
      SOURCE_CONFIDENCE.indexOf("confirmed")
    );
  });
});
