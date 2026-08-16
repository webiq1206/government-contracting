import { describe, it, expect } from "vitest";
import { competitiveVerdict, type CompetitorAggregate } from "@/lib/domain/competition";

const firm = (
  recipient_name: string,
  award_count: number,
  median_adj = 0,
  is_incumbent = false
): CompetitorAggregate => ({ recipient_name, award_count, median_adj, is_incumbent });

/** The live Guam landscape: 33 firms, Island Certs holding with 50 wins. */
const GUAM: CompetitorAggregate[] = [
  firm("ISLAND CERTS CORPORATION", 50, 28_531, true),
  firm("CABRAS MARINE CORPORATION", 14, 77_819),
  firm("ALLIANCE WORLDWIDE DISTRIBUTING LLC", 10, 1_987_314),
  firm("GREEN CLOVER SERVICES INC", 10, 415_939),
  firm("EST COMPANIES LLC", 10, 244_869),
  firm("GUAM & MICRONESIAN ISLANDS SCUBA WHOLESALE", 6, 6_985),
];

describe("competitive verdict", () => {
  it("calls out an entrenched incumbent and names the price to beat", () => {
    const v = competitiveVerdict(GUAM, {
      incumbentName: "ISLAND CERTS CORPORATION",
      incumbentLastAward: 31_961,
      isRecompete: true,
    })!;
    expect(v.headline).toMatch(/entrenched incumbent/);
    expect(v.headline).toMatch(/won this work 50 times/);
    expect(v.whatItMeans).toMatch(/asking them to switch/);
    expect(v.priceGuidance).toMatch(/\$31,961/);
    expect(v.tone).toBe("risk");
    expect(v.confidence).toBe("high");
  });

  it("falls back to the incumbent's typical award when the last one is unknown", () => {
    const v = competitiveVerdict(GUAM, { isRecompete: true })!;
    expect(v.priceGuidance).toMatch(/\$28,531/);
  });

  it("says so when the incumbent's amounts are not published", () => {
    const v = competitiveVerdict(
      [firm("HOLDER LLC", 8, 0, true), firm("OTHER LLC", 6), firm("THIRD LLC", 5)],
      { isRecompete: true }
    )!;
    expect(v.priceGuidance).toMatch(/not published/);
  });

  it("reads a held-but-not-dominant recompete as worth bidding", () => {
    const v = competitiveVerdict(
      [
        firm("HOLDER LLC", 4, 50_000, true),
        firm("A LLC", 4),
        firm("B LLC", 4),
        firm("C LLC", 4),
        firm("D LLC", 4),
        firm("E LLC", 4),
        firm("F LLC", 4),
      ],
      { isRecompete: true }
    )!;
    expect(v.headline).toMatch(/currently holds this work/);
    expect(v.whatItMeans).toMatch(/does not dominate/);
    expect(v.tone).toBe("neutral");
  });

  it("encourages an open field without an incumbent", () => {
    const v = competitiveVerdict([
      firm("A", 3),
      firm("B", 3),
      firm("C", 3),
      firm("D", 3),
      firm("E", 3),
      firm("F", 3),
      firm("G", 3),
      firm("H", 3),
    ])!;
    expect(v.tone).toBe("open");
    expect(v.headline).toMatch(/Open field/);
    expect(v.whatItMeans).toMatch(/new name is not a strike against you/);
  });

  it("warns on a concentrated field with no incumbent, naming the leaders", () => {
    const v = competitiveVerdict([
      firm("BIG ONE", 20),
      firm("BIG TWO", 15),
      firm("BIG THREE", 10),
      firm("SMALL", 2),
    ])!;
    expect(v.tone).toBe("risk");
    expect(v.whatItMeans).toMatch(/BIG ONE, BIG TWO, BIG THREE/);
    expect(v.whatItMeans).toMatch(/no incumbent on this particular job/);
  });

  it("admits when there is too little history to read the field", () => {
    const v = competitiveVerdict([firm("ONLY LLC", 2), firm("OTHER LLC", 1)])!;
    expect(v.confidence).toBe("low");
    expect(v.confidenceNote).toMatch(/too little/);
  });

  it("returns nothing when there are no competitors at all", () => {
    expect(competitiveVerdict([])).toBeNull();
  });
});
