import { describe, it, expect } from "vitest";
import { mapSamEntity } from "@/lib/integrations/sam";

/**
 * SAM's entity payload, in the shape the v3 API actually returns.
 *
 * Deeply nested, inconsistently populated, and mixing genuine certifications
 * with plain descriptors in the same list. The mapper is what stops that
 * shape leaking into the profile, so it is tested against the real thing
 * rather than against a tidied-up version of it.
 */
const RAW = {
  entityRegistration: {
    ueiSAM: "ABC123DEF456",
    cageCode: "7X8Y9",
    legalBusinessName: "  Newman Construction LLC  ",
    dbaName: "Newman Builders",
    registrationStatus: "Active",
    registrationExpirationDate: "2027-03-14",
  },
  coreData: {
    physicalAddress: {
      addressLine1: "412 Front Street",
      addressLine2: "Suite 3",
      city: "Boise",
      stateOrProvinceCode: "ID",
      zipCode: "83702",
    },
    entityInformation: { entityStructureDesc: "Limited Liability Company" },
    businessTypes: {
      businessTypeList: [
        { businessTypeDesc: "For Profit Organization" },
        { businessTypeDesc: "Limited Liability Company" },
        { businessTypeDesc: "Woman Owned Small Business" },
        { businessTypeDesc: "Service Disabled Veteran Owned Small Business" },
      ],
    },
  },
  assertions: {
    goodsAndServices: {
      naicsList: [
        { naicsCode: "236220", naicsDescription: "Commercial Building Construction" },
        { naicsCode: "238220", naicsDescription: "Plumbing and HVAC" },
        { naicsCode: "236220", naicsDescription: "duplicate" },
        { naicsCode: "", naicsDescription: "blank" },
        { naicsCode: "23X", naicsDescription: "malformed" },
      ],
    },
  },
};

describe("mapping a SAM registration onto a profile", () => {
  const e = mapSamEntity(RAW);

  it("pulls the federal identifiers that go on every bid", () => {
    expect(e.uei).toBe("ABC123DEF456");
    expect(e.cageCode).toBe("7X8Y9");
  });

  it("trims the whitespace SAM stores names with", () => {
    expect(e.legalName).toBe("Newman Construction LLC");
    expect(e.dba).toBe("Newman Builders");
  });

  it("builds one readable mailing address from the parts", () => {
    expect(e.physicalAddress).toBe("412 Front Street Suite 3, Boise, ID, 83702");
    expect(e.entityState).toBe("ID");
  });

  it("keeps only well-formed NAICS codes, deduplicated", () => {
    // A malformed code would produce a SAM search that returns nothing, and a
    // duplicate would double the request budget for no extra coverage.
    expect(e.naicsCodes).toEqual(["236220", "238220"]);
  });

  /**
   * The important one. businessTypeList mixes set-aside certifications with
   * descriptors like "For Profit Organization". Claiming a descriptor as a
   * certification on a federal bid is a false certification.
   */
  it("takes real certifications and leaves plain descriptors behind", () => {
    expect(e.certifications).toContain("Woman Owned Small Business");
    expect(e.certifications).toContain("Service Disabled Veteran Owned Small Business");
    expect(e.certifications).not.toContain("For Profit Organization");
    expect(e.certifications).not.toContain("Limited Liability Company");
  });

  it("carries the registration status, so an expired one can be flagged", () => {
    expect(e.registrationStatus).toBe("Active");
    expect(e.registrationExpiresAt).toBe("2027-03-14");
  });

  it("survives a registration with almost nothing on it", () => {
    const sparse = mapSamEntity({ entityRegistration: { ueiSAM: "ZZZ999YYY888" } });
    expect(sparse.uei).toBe("ZZZ999YYY888");
    expect(sparse.legalName).toBeNull();
    expect(sparse.physicalAddress).toBeNull();
    expect(sparse.naicsCodes).toEqual([]);
    expect(sparse.certifications).toEqual([]);
  });

  it("survives an empty object rather than throwing", () => {
    const empty = mapSamEntity({});
    expect(empty.uei).toBeNull();
    expect(empty.naicsCodes).toEqual([]);
  });
});
