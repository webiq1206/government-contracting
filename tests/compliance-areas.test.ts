/**
 * The six areas, and the one that was never on the board.
 *
 * Two things are being pinned here. That grouping is by area rather than by
 * whatever the category column happens to contain, so a new category does not
 * silently create a new heading nobody designed. And that subcontractor
 * paperwork produces an item at all, with the failure ordered by exposure:
 * coverage that has lapsed above coverage that was never sent.
 */
import { describe, it, expect } from "vitest";
import {
  areaFor,
  subcontractorComplianceBoard,
  AREA_LABEL,
  AREA_EXPLANATION,
  AREA_ORDER,
  parseArea,
  parseState,
  stateOf,
  STATE_LABEL,
  type SubComplianceInput,
} from "@/lib/domain/compliance-areas";
import type { ComplianceDoc } from "@/lib/domain/sub-compliance";

const NOW = new Date("2026-08-26T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

function doc(over: Partial<ComplianceDoc> & { doc_type: string }): ComplianceDoc {
  return {
    status: "active",
    expires_at: days(400),
    signed_at: days(-30),
    verified_at: days(-30),
    ...over,
  };
}

/** Everything a subcontractor needs, all of it current and checked. */
function cleared(): ComplianceDoc[] {
  return [
    doc({ doc_type: "w9", expires_at: null }),
    doc({ doc_type: "coi_general_liability" }),
    doc({ doc_type: "coi_workers_comp" }),
  ];
}

function sub(over: Partial<SubComplianceInput> = {}): SubComplianceInput {
  return {
    subId: "s1",
    companyName: "Acme Electric",
    docs: cleared(),
    onContract: false,
    ...over,
  };
}

describe("areaFor", () => {
  it("puts the registrations that gate an award together", () => {
    /*
     * These were two unrelated headings on the board. They answer one
     * question -- can this company legally be awarded work -- and an operator
     * who checks one and not the other has checked nothing.
     */
    expect(areaFor("sam_registration")).toBe("company_registrations");
    expect(areaFor("state_llc")).toBe("company_registrations");
  });

  it("maps each remaining category to its area", () => {
    expect(areaFor("certification")).toBe("certifications");
    expect(areaFor("insurance")).toBe("insurance_bonding");
    expect(areaFor("bonding")).toBe("insurance_bonding");
    expect(areaFor("cpars")).toBe("contract_specific");
    expect(areaFor("contract_deadline")).toBe("contract_specific");
    expect(areaFor("far_change")).toBe("regulatory");
  });

  it("is case and whitespace tolerant", () => {
    expect(areaFor("  SAM_Registration ")).toBe("company_registrations");
  });

  it("lands an unknown category somewhere a person will look", () => {
    /*
     * Not an "Other" bucket. A category nobody has mapped yet is far more
     * likely to be another thing the company must keep current than a new
     * kind of thing, and "Other" is where items go to be ignored.
     */
    expect(areaFor("new_thing_nobody_mapped")).toBe("company_registrations");
    expect(areaFor(null)).toBe("company_registrations");
    expect(areaFor(undefined)).toBe("company_registrations");
    expect(areaFor("")).toBe("company_registrations");
  });
});

describe("the area vocabulary", () => {
  it("orders every area exactly once", () => {
    expect(new Set(AREA_ORDER).size).toBe(AREA_ORDER.length);
    expect(AREA_ORDER.length).toBe(Object.keys(AREA_LABEL).length);
  });

  it("gives every area a label and an explanation", () => {
    for (const area of AREA_ORDER) {
      expect(AREA_LABEL[area]).toBeTruthy();
      expect(AREA_EXPLANATION[area].length).toBeGreaterThan(20);
    }
  });
});

describe("subcontractorComplianceBoard", () => {
  it("says nothing about a subcontractor whose paperwork is current", () => {
    const board = subcontractorComplianceBoard([sub()], NOW);
    expect(board.items).toEqual([]);
    expect(board.currentCount).toBe(1);
  });

  it("raises lapsed coverage as the exposure it is", () => {
    const board = subcontractorComplianceBoard(
      [
        sub({
          docs: [
            doc({ doc_type: "w9", expires_at: null }),
            doc({ doc_type: "coi_general_liability", expires_at: days(-3) }),
            doc({ doc_type: "coi_workers_comp" }),
          ],
        }),
      ],
      NOW
    );
    expect(board.items).toHaveLength(1);
    expect(board.items[0].color).toBe("red");
    expect(board.items[0].statusLabel).toBe("Coverage lapsed");
    expect(board.items[0].reason).toContain("General liability insurance");
    expect(board.items[0].dueDay).toBe(days(-3).slice(0, 10));
  });

  it("treats a gap on a contract as worse than a gap on a prospect", () => {
    /*
     * The same absent document means two different things. On a contract the
     * subcontractor is already working and cannot be paid; off one, nobody
     * has asked for it yet. Giving both the same colour would either cry wolf
     * or hide the one that matters.
     */
    const onContract = subcontractorComplianceBoard(
      [sub({ docs: [], onContract: true })],
      NOW
    );
    const prospect = subcontractorComplianceBoard(
      [sub({ subId: "s2", docs: [], onContract: false })],
      NOW
    );
    expect(onContract.items[0].color).toBe("red");
    expect(onContract.items[0].nextAction).toContain("cannot be paid");
    expect(prospect.items[0].color).toBe("amber");
  });

  it("names an unverified upload as waiting on a person, not as missing", () => {
    const board = subcontractorComplianceBoard(
      [
        sub({
          docs: [
            doc({ doc_type: "w9", expires_at: null }),
            doc({ doc_type: "coi_general_liability", verified_at: null }),
            doc({ doc_type: "coi_workers_comp" }),
          ],
        }),
      ],
      NOW
    );
    expect(board.items[0].statusLabel).toBe("Waiting on your check");
    expect(board.items[0].color).toBe("amber");
  });

  it("prompts on a certificate about to lapse without blocking on it", () => {
    const board = subcontractorComplianceBoard(
      [
        sub({
          docs: [
            doc({ doc_type: "w9", expires_at: null }),
            doc({ doc_type: "coi_general_liability", expires_at: days(9) }),
            doc({ doc_type: "coi_workers_comp" }),
          ],
        }),
      ],
      NOW
    );
    expect(board.items[0].statusLabel).toBe("Expires soon");
    expect(board.items[0].color).toBe("amber");
    expect(board.items[0].dueDay).toBe(days(9).slice(0, 10));
  });

  it("puts lapsed above absent, and dates the tie-break", () => {
    const board = subcontractorComplianceBoard(
      [
        sub({ subId: "a", companyName: "Absent", docs: [], onContract: false }),
        sub({
          subId: "b",
          companyName: "Older lapse",
          docs: [
            doc({ doc_type: "w9", expires_at: null }),
            doc({ doc_type: "coi_general_liability", expires_at: days(-40) }),
            doc({ doc_type: "coi_workers_comp" }),
          ],
        }),
        sub({
          subId: "c",
          companyName: "Newer lapse",
          docs: [
            doc({ doc_type: "w9", expires_at: null }),
            doc({ doc_type: "coi_general_liability", expires_at: days(-2) }),
            doc({ doc_type: "coi_workers_comp" }),
          ],
        }),
      ],
      NOW
    );
    expect(board.items.map((i) => i.subId)).toEqual(["b", "c", "a"]);
  });

  it("counts the clear ones separately from the ones with work to do", () => {
    const board = subcontractorComplianceBoard(
      [
        sub({ subId: "a" }),
        sub({ subId: "b" }),
        sub({ subId: "c", docs: [], onContract: true }),
      ],
      NOW
    );
    expect(board.items).toHaveLength(1);
    expect(board.currentCount).toBe(2);
  });

  it("reads a subcontractor with no documents at all rather than throwing", () => {
    expect(() => subcontractorComplianceBoard([], NOW)).not.toThrow();
    expect(subcontractorComplianceBoard([], NOW)).toEqual({ items: [], currentCount: 0 });
  });
});

describe("board filters", () => {
  it("maps each card colour to the state a person filters by", () => {
    expect(stateOf("red")).toBe("attention");
    expect(stateOf("amber")).toBe("expiring");
    expect(stateOf("slate")).toBe("cannot_monitor");
    expect(stateOf("green")).toBe("on_track");
  });

  it("labels every state", () => {
    for (const st of ["attention", "expiring", "cannot_monitor", "on_track"] as const) {
      expect(STATE_LABEL[st]).toBeTruthy();
    }
  });

  it("never says On track for something with no date", () => {
    /*
     * The colour for a dateless item is slate, and slate must not land in
     * on_track. A green badge asserting an item is fine when the system has
     * nothing to check it against is the exact failure the audit named, and
     * the filter is a second place it could reappear.
     */
    expect(stateOf("slate")).not.toBe("on_track");
    expect(STATE_LABEL[stateOf("slate")]).toBe("Cannot monitor");
  });

  it("falls open to the unfiltered board on a bad parameter", () => {
    /*
     * Null means no filter, which shows everything. A bad parameter must not
     * be able to hide compliance items -- guessing at what was meant, or
     * failing closed to an empty board, both end with somebody looking at a
     * page that is missing an expiry they needed to see.
     */
    expect(parseState("nonsense")).toBeNull();
    expect(parseState(undefined)).toBeNull();
    expect(parseState("")).toBeNull();
    expect(parseArea("nonsense")).toBeNull();
    expect(parseArea(undefined)).toBeNull();
  });

  it("reads a valid parameter, including a repeated one", () => {
    expect(parseState("expiring")).toBe("expiring");
    expect(parseState(["attention", "on_track"])).toBe("attention");
    expect(parseArea("subcontractor")).toBe("subcontractor");
    expect(parseArea(["regulatory"])).toBe("regulatory");
  });
});
