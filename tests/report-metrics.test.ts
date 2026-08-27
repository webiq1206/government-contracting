/**
 * The rules the reported numbers are held to.
 *
 * Two of them, and both are about refusing to say more than the records
 * support: a metric with nothing behind it is null rather than nought, and a
 * dollar figure says whether it was published, estimated, or absent.
 */
import { describe, it, expect } from "vitest";
import {
  share,
  metric,
  valueBasis,
  splitValue,
  coverageSentence,
  expectedValue,
} from "../lib/domain/report-metrics";

describe("share", () => {
  it("is null on an empty denominator rather than nought", () => {
    // The whole reason this helper exists. An account that has submitted
    // nothing has no win rate; printing 0% tells somebody their process is
    // broken when it has simply not run yet.
    expect(share(0, 0)).toBeNull();
    expect(share(3, 0)).toBeNull();
  });

  it("is nought when nought of a real denominator qualified", () => {
    // Distinct from the above, and it must stay distinct: nought of forty is
    // a finding.
    expect(share(0, 40)).toBe(0);
  });

  it("rounds to one decimal", () => {
    expect(share(1, 3)).toBe(33.3);
  });
});

describe("metric", () => {
  const prov = { formula: "a over b", sources: ["bids"], inclusion: "decided bids only" };

  it("carries the reason when there is no value", () => {
    const m = metric("win_rate", "Win rate", "percent", null, "No bids decided yet", prov);
    expect(m.value).toBeNull();
    expect(m.absent).toBe("No bids decided yet");
  });

  it("drops the reason once there is a value", () => {
    const m = metric("win_rate", "Win rate", "percent", 40, "No bids decided yet", prov);
    expect(m.absent).toBeNull();
  });
});

describe("valueBasis", () => {
  it("treats a published figure as known", () => {
    expect(valueBasis(500_000_00, "sam")).toBe("known");
    expect(valueBasis(500_000_00, "operator")).toBe("known");
  });

  it("treats the analyst's reading as modeled, not published", () => {
    // It is a good guess made by reading the solicitation. It is still a
    // guess, and adding it to a published total hides which is which.
    expect(valueBasis(500_000_00, "analysis")).toBe("modeled");
  });

  it("treats an unfamiliar source as modeled rather than known", () => {
    // Defaulting the other way would let a new writer quietly promote its
    // guesses to fact by picking a source name nobody added here.
    expect(valueBasis(500_000_00, "some_new_scraper")).toBe("modeled");
  });

  it("treats a missing or nought figure as unknown", () => {
    expect(valueBasis(null, "sam")).toBe("unknown");
    expect(valueBasis(0, "sam")).toBe("unknown");
    expect(valueBasis(500_000_00, null)).toBe("unknown");
  });
});

describe("splitValue", () => {
  const rows = [
    { cents: 100_00, source: "sam" },
    { cents: 200_00, source: "sam" },
    { cents: 400_00, source: "analysis" },
    { cents: null, source: null },
    { cents: null, source: "sam" },
  ];

  it("keeps published and estimated totals apart", () => {
    const s = splitValue(rows);
    expect(s.known).toEqual({ count: 2, total: 300_00 });
    expect(s.modeled).toEqual({ count: 1, total: 400_00 });
  });

  it("counts the valueless without valuing them", () => {
    // The rule the whole file exists for: a missing estimate is not zero, so
    // the unknown bucket has a count and no total to add into anything.
    const s = splitValue(rows);
    expect(s.unknown.count).toBe(2);
    expect(s.unknown).not.toHaveProperty("total");
  });
});

describe("coverageSentence", () => {
  it("says nothing is in range rather than claiming full coverage", () => {
    expect(coverageSentence(splitValue([]))).toBe("Nothing in range yet.");
  });

  it("says so plainly when everything publishes a value", () => {
    const s = splitValue([{ cents: 1, source: "sam" }]);
    expect(coverageSentence(s)).toContain("Every one");
  });

  it("names each group rather than giving a percentage", () => {
    // "from 2 of 41 that publish one" tells an operator what to do about it.
    // "5% coverage" does not.
    const s = splitValue([
      { cents: 1, source: "sam" },
      { cents: 1, source: "analysis" },
      { cents: null, source: null },
    ]);
    const line = coverageSentence(s);
    expect(line).toContain("1 published a value");
    expect(line).toContain("1 were estimated");
    expect(line).toContain("1 carry no figure at all");
  });
});

describe("expectedValue", () => {
  it("weights the open pipeline by the measured win rate", () => {
    expect(expectedValue(1_000_000, 25)).toBe(250_000);
  });

  it("refuses to forecast without a measured win rate", () => {
    // An expected value computed against an assumed rate is a made-up number
    // wearing a real one's clothes.
    expect(expectedValue(1_000_000, null)).toBeNull();
  });

  it("is null rather than nought when there is no open value", () => {
    expect(expectedValue(0, 25)).toBeNull();
  });
});
