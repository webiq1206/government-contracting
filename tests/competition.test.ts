import { describe, it, expect } from "vitest";
import {
  competitionRead,
  competitivePositioningBrief,
  type CompetitorAggregate,
} from "@/lib/domain/competition";

/** Build a competitor list from win counts; other fields are irrelevant here. */
function firms(...counts: number[]): CompetitorAggregate[] {
  return counts.map((n, i) => ({
    recipient_name: `Firm ${i + 1}`,
    award_count: n,
    median_adj: 0,
    is_incumbent: i === 0,
  }));
}

describe("competitionRead", () => {
  it("totals awards and firm count across all competitors", () => {
    const r = competitionRead(firms(5, 3, 2, 1));
    expect(r.firmCount).toBe(4);
    expect(r.totalAwards).toBe(11);
  });

  it("measures top-3 share of awards", () => {
    // top 3 = 5+3+2 = 10 of 12 total -> 0.833...
    const r = competitionRead(firms(5, 3, 2, 1, 1));
    expect(r.top3Share).toBeCloseTo(10 / 12, 5);
  });

  it("flags a concentrated field when the top 3 hold >=70%", () => {
    const r = competitionRead(firms(8, 1, 1)); // 10/10 = 100%
    expect(r.tone).toBe("risk");
    expect(r.label).toBe("Concentrated field");
  });

  it("flags a fragmented field when spread across many firms (<=45%, >=6 firms)", () => {
    // 6 firms, each 1 win: top 3 = 3/6 = 50% -> not fragmented yet
    expect(competitionRead(firms(1, 1, 1, 1, 1, 1)).label).not.toBe("Fragmented field");
    // 8 firms, top 3 = 3/8 = 37.5% -> fragmented
    const r = competitionRead(firms(1, 1, 1, 1, 1, 1, 1, 1));
    expect(r.tone).toBe("open");
    expect(r.label).toBe("Fragmented field");
  });

  it("calls a middling field moderately competitive", () => {
    // top 3 = 4+3+2 = 9 of 15 -> 60%, between the thresholds
    const r = competitionRead(firms(4, 3, 2, 2, 2, 2));
    expect(r.tone).toBe("neutral");
    expect(r.label).toBe("Moderately competitive");
  });

  it("does not divide by zero on an empty field", () => {
    const r = competitionRead([]);
    expect(r.firmCount).toBe(0);
    expect(r.totalAwards).toBe(0);
    expect(r.top3Share).toBe(0);
  });

  it("a few firms with low concentration stays neutral, not fragmented", () => {
    // fewer than 6 firms can never be 'fragmented' even at low share
    const r = competitionRead(firms(1, 1, 1, 1)); // top3 = 3/4 = 75% anyway
    expect(r.label).not.toBe("Fragmented field");
  });
});

describe("competitivePositioningBrief", () => {
  it("returns null with no award history (narrative prompt stays baseline)", () => {
    expect(competitivePositioningBrief([])).toBeNull();
  });

  it("always carries the no-naming / no-comparative-claims guardrail", () => {
    const brief = competitivePositioningBrief(firms(3, 2, 1))!;
    expect(brief).toContain("do NOT name any competitor");
    expect(brief.toLowerCase()).toContain("only to decide what to emphasize");
  });

  it("adds recompete guidance when an incumbent is present", () => {
    // firms() marks the first firm incumbent
    const brief = competitivePositioningBrief(firms(4, 1, 1))!;
    expect(brief.toLowerCase()).toContain("recompete");
    expect(brief.toLowerCase()).toContain("reason to switch");
  });

  it("omits recompete guidance when no incumbent and none forced", () => {
    const noIncumbent: CompetitorAggregate[] = firms(3, 2, 1).map((c) => ({
      ...c,
      is_incumbent: false,
    }));
    const brief = competitivePositioningBrief(noIncumbent)!;
    expect(brief.toLowerCase()).not.toContain("recompete");
  });

  it("tailors emphasis to a concentrated field", () => {
    const brief = competitivePositioningBrief(firms(8, 1, 1))!;
    expect(brief.toLowerCase()).toContain("concentrated");
  });

  it("tailors emphasis to a fragmented field", () => {
    const brief = competitivePositioningBrief(firms(1, 1, 1, 1, 1, 1, 1, 1))!;
    expect(brief.toLowerCase()).toContain("fragmented");
  });

  it("never leaks a competitor's name into the proposal-facing brief", () => {
    const named: CompetitorAggregate[] = [
      { recipient_name: "Acme Federal LLC", award_count: 5, median_adj: 0, is_incumbent: true },
      { recipient_name: "Beta Builders Inc", award_count: 2, median_adj: 0, is_incumbent: false },
    ];
    const brief = competitivePositioningBrief(named)!;
    expect(brief).not.toContain("Acme Federal LLC");
    expect(brief).not.toContain("Beta Builders Inc");
  });
});
