import { describe, expect, it } from "vitest";
import { AGENCY_UNKNOWN, agencyLevels, shortenAgency } from "../lib/domain/agency-path";

/**
 * Agency names, shortened without being falsified.
 *
 * A buying office arrives as a path, forty to eighty characters, and the first
 * two thirds of it is identical on every row an army contractor will ever see.
 * The column truncated at a character count rather than at a meaning, so every
 * cell read "DEPT OF DEFENSE, DEPT OF THE A..." and the part that varied was
 * the part that got cut.
 */

describe("splitting a path", () => {
  it("folds the department and the service into one list", () => {
    expect(agencyLevels("DEPT OF DEFENSE", "DEPT OF THE ARMY")).toEqual([
      "DEPT OF DEFENSE",
      "DEPT OF THE ARMY",
    ]);
  });

  it("splits a path that arrived in one field", () => {
    expect(agencyLevels("DEPT OF DEFENSE / DEPT OF THE ARMY / AMC / ACC")).toEqual([
      "DEPT OF DEFENSE",
      "DEPT OF THE ARMY",
      "AMC",
      "ACC",
    ]);
  });

  it("counts a level arriving in both fields once", () => {
    // SAM repeats the department in sub_agency often enough that a naive
    // concatenation shows it twice on the record page.
    expect(agencyLevels("DEPT OF THE ARMY", "dept of the army / ACC")).toEqual([
      "DEPT OF THE ARMY",
      "ACC",
    ]);
  });
});

describe("what the row shows", () => {
  it("shows the level that tells one row from another", () => {
    const d = shortenAgency(
      "DEPT OF DEFENSE / DEPT OF THE ARMY / AMC / ACC / 411TH CONTRACTING SUPPORT BRIGADE"
    );
    expect(d.short).toBe("411TH CONTRACTING SUPPORT BRIGADE");
    expect(d.hidden).toBe(4);
  });

  it("keeps the parent when the last level is a bare acronym", () => {
    // "ACC" is not an office. The level above it is what makes it one.
    const d = shortenAgency("DEPT OF DEFENSE / DEPT OF THE ARMY / AMC / ACC");
    expect(d.short).toBe("AMC / ACC");
    expect(d.hidden).toBe(2);
  });

  it("carries the whole path for the record page and the screen reader", () => {
    const d = shortenAgency("DEPT OF DEFENSE", "DEPT OF THE ARMY / ACC-Fort Bliss");
    expect(d.full).toBe("DEPT OF DEFENSE / DEPT OF THE ARMY / ACC-Fort Bliss");
    expect(d.shortened).toBe(true);
  });

  it("does not claim to have shortened something it did not", () => {
    const d = shortenAgency("GENERAL SERVICES ADMINISTRATION");
    expect(d.short).toBe("GENERAL SERVICES ADMINISTRATION");
    expect(d.shortened).toBe(false);
    expect(d.hidden).toBe(0);
  });

  it("says the agency is not on the record rather than printing a dash", () => {
    /*
     * A dash in an agency column is indistinguishable from a rendering fault,
     * and this is the field an operator uses to decide whether a solicitation
     * is worth reading at all.
     */
    expect(shortenAgency(null).short).toBe(AGENCY_UNKNOWN);
    expect(shortenAgency("").short).toBe(AGENCY_UNKNOWN);
    expect(shortenAgency("   ", "  ").short).toBe(AGENCY_UNKNOWN);
  });
});
