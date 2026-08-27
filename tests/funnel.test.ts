import { describe, it, expect } from "vitest";
import {
  FUNNEL_STEPS,
  buildFunnel,
  worstDropOff,
  formatRate,
  formatDays,
  parseRange,
  rangeDays,
  rangeLabel,
  comparisonLabel,
  compare,
  describeDelta,
  snapshotFreshness,
  breakdownLines,
  parseBreakdown,
  breakdownLabel,
  type FunnelCounts,
  type FunnelKey,
} from "@/lib/domain/funnel";

function counts(partial: Partial<Record<FunnelKey, number>>): FunnelCounts {
  const zero = Object.fromEntries(FUNNEL_STEPS.map((s) => [s.key, 0])) as Record<
    FunnelKey,
    number
  >;
  return {
    reached: { ...zero, ...partial },
    droppedBefore: { ...zero },
    pendingBefore: { ...zero },
    medianDaysInto: {},
    won: 0,
    lost: 0,
  };
}

describe("buildFunnel", () => {
  it("names the nine steps the audit asks for, in order", () => {
    expect(FUNNEL_STEPS.map((s) => s.label)).toEqual([
      "Found",
      "Scored",
      "Pursued",
      "Subs contacted",
      /*
       * The step that separates two different problems. Without it, "40
       * contacted, 3 quoted" cannot say whether nobody answered or plenty
       * answered and would not price the work.
       */
      "Replies received",
      "Quotes received",
      "Bid built",
      "Submitted",
      "Won or lost",
    ]);
  });

  it("never lets a later step outnumber the one before it", () => {
    /*
     * The property the whole shape rests on. A quote logged with no inbound
     * message still counts as a reply, because the quote is the reply; without
     * that, the replies row could come back smaller than the quotes row and
     * read as a bug whichever way it was explained.
     */
    const steps = buildFunnel(
      counts({
        found: 50, scored: 50, pursued: 30, subs_contacted: 20,
        replies_received: 12, quotes_received: 12, bid_built: 6, submitted: 4,
      })
    );
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].count, `${steps[i].label} exceeds ${steps[i - 1].label}`)
        .toBeLessThanOrEqual(steps[i - 1].count);
    }
  });

  it("computes conversion from the previous step and from the top", () => {
    const steps = buildFunnel(
      counts({ found: 100, scored: 80, pursued: 40, subs_contacted: 20 })
    );
    expect(steps[1].rateFromPrevious).toBe(80);
    expect(steps[2].rateFromPrevious).toBe(50);
    expect(steps[3].rateFromPrevious).toBe(50);
    expect(steps[3].rateFromFound).toBe(20);
  });

  it("gives the first step no conversion rate, because it converts from nothing", () => {
    const steps = buildFunnel(counts({ found: 12 }));
    expect(steps[0].rateFromPrevious).toBeNull();
    expect(steps[0].rateFromFound).toBeNull();
  });

  it("returns null, never 0 percent, when the previous step is empty", () => {
    const steps = buildFunnel(counts({ found: 0 }));
    for (const s of steps.slice(1)) {
      expect(s.rateFromPrevious).toBeNull();
      expect(s.rateFromFound).toBeNull();
    }
    expect(steps.every((s) => s.rateFromPrevious !== 0)).toBe(true);
  });

  it("keeps a genuine zero conversion distinct from an absent one", () => {
    const steps = buildFunnel(counts({ found: 30, scored: 30, pursued: 0 }));
    expect(steps[2].rateFromPrevious).toBe(0);
    expect(formatRate(steps[2].rateFromPrevious)).toBe("0%");
    expect(formatRate(null)).toBe("No cohort");
  });

  it("rounds a rate to one decimal place", () => {
    const steps = buildFunnel(counts({ found: 3, scored: 1 }));
    expect(steps[1].rateFromPrevious).toBe(33.3);
  });

  it("carries drops and still-in-flight work separately", () => {
    const c = counts({ found: 10, scored: 10, pursued: 4 });
    c.droppedBefore.pursued = 2;
    c.pendingBefore.pursued = 4;
    const steps = buildFunnel(c);
    expect(steps[2].dropped).toBe(2);
    expect(steps[2].pending).toBe(4);
  });

  it("passes a measured median through and leaves an unmeasured one null", () => {
    const c = counts({ found: 5, scored: 5, subs_contacted: 3 });
    c.medianDaysInto.subs_contacted = 2.4;
    const steps = buildFunnel(c);
    expect(steps[3].medianDays).toBe(2.4);
    expect(steps[1].medianDays).toBeNull();
  });
});

describe("worstDropOff", () => {
  it("points at the step that loses the most closed work", () => {
    const c = counts({ found: 20, scored: 20, pursued: 8, subs_contacted: 6 });
    c.droppedBefore.pursued = 12;
    c.droppedBefore.subs_contacted = 2;
    expect(worstDropOff(buildFunnel(c))?.key).toBe("pursued");
  });

  it("names nothing when everything short of the end is still open", () => {
    const c = counts({ found: 9, scored: 9 });
    c.pendingBefore.pursued = 9;
    expect(worstDropOff(buildFunnel(c))).toBeNull();
  });
});

describe("formatDays", () => {
  it("does not round a real span down to nothing", () => {
    expect(formatDays(0.2)).toBe("Under a day");
    expect(formatDays(1.4)).toBe("About a day");
    expect(formatDays(6.6)).toBe("7 days");
  });

  it("says an unmeasured span is unmeasured", () => {
    expect(formatDays(null)).toBe("Not recorded");
  });
});

describe("range", () => {
  it("defaults to ninety days and rejects anything else", () => {
    expect(parseRange(undefined)).toBe("90");
    expect(parseRange("nonsense")).toBe("90");
    expect(parseRange(["30"])).toBe("90");
    expect(parseRange("30")).toBe("30");
    expect(parseRange("all")).toBe("all");
  });

  it("has no day count and no comparison period for all time", () => {
    expect(rangeDays("all")).toBeNull();
    expect(comparisonLabel("all")).toBeNull();
    expect(comparisonLabel("30")).toBe("the 30 days before that");
    expect(rangeLabel("365")).toBe("Last 12 months");
  });
});

describe("compare", () => {
  it("reports a rise with its percentage", () => {
    const d = compare(12, 8);
    expect(d).toEqual({ change: 4, direction: "up", pct: 50 });
    expect(describeDelta(d, "the 30 days before that")).toBe(
      "4 more than the 30 days before that (+50%)"
    );
  });

  it("reports a fall", () => {
    const d = compare(3, 6);
    expect(d?.direction).toBe("down");
    expect(describeDelta(d, "last month")).toBe("3 fewer than last month (-50%)");
  });

  it("gives growth from nothing no percentage rather than an infinite one", () => {
    const d = compare(5, 0);
    expect(d?.pct).toBeNull();
    expect(describeDelta(d, "last month")).toBe("5 more than last month");
  });

  it("says so when nothing moved", () => {
    expect(describeDelta(compare(4, 4), "last month")).toBe("no change from last month");
  });
});

describe("snapshotFreshness", () => {
  const now = new Date("2026-08-25T12:00:00Z");

  it("calls a never-run snapshot stale rather than current", () => {
    const f = snapshotFreshness(null, now);
    expect(f.state).toBe("never");
    expect(f.stale).toBe(true);
    expect(f.label).toBe("Never computed");
  });

  it("treats an unparseable timestamp as never run", () => {
    expect(snapshotFreshness("not a date", now).state).toBe("never");
  });

  it("dates a recent run in hours", () => {
    const f = snapshotFreshness(new Date("2026-08-25T09:00:00Z"), now);
    expect(f.label).toBe("Computed 3 hours ago");
    expect(f.stale).toBe(false);
  });

  it("dates an older run in days", () => {
    const f = snapshotFreshness(new Date("2026-08-22T12:00:00Z"), now);
    expect(f.label).toBe("Computed 3 days ago");
    expect(f.state).toBe("aging");
  });

  it("marks anything past a week stale", () => {
    const f = snapshotFreshness(new Date("2026-08-01T12:00:00Z"), now);
    expect(f.state).toBe("stale");
    expect(f.stale).toBe(true);
    expect(f.label).toBe("Computed 24 days ago");
  });

  it("accepts the Date that node-postgres actually returns", () => {
    expect(snapshotFreshness(new Date("2026-08-25T11:30:00Z"), now).state).toBe("fresh");
  });
});

describe("breakdownLines", () => {
  const row = {
    key: "GSA",
    found: 20,
    pursued: 10,
    submitted: 4,
    won: 1,
    lost: 1,
  };

  it("computes pursuit and submission rates against the right denominator", () => {
    const [l] = breakdownLines([row]);
    expect(l.pursuitRate).toBe(50);
    expect(l.submissionRate).toBe(40);
  });

  it("computes win rate over decided bids, not over submissions", () => {
    const [l] = breakdownLines([row]);
    // Two of the four submitted bids are still with the agency. Counting them
    // as losses would report 25% on a record that is actually even.
    expect(l.winRate).toBe(50);
    expect(l.undecided).toBe(2);
  });

  it("has no win rate at all for a row where nothing has been decided", () => {
    const [l] = breakdownLines([{ ...row, won: 0, lost: 0 }]);
    expect(l.winRate).toBeNull();
    expect(l.undecided).toBe(4);
  });

  it("has no submission rate for a row that was never pursued", () => {
    const [l] = breakdownLines([
      { key: "Navy", found: 6, pursued: 0, submitted: 0, won: 0, lost: 0 },
    ]);
    expect(l.submissionRate).toBeNull();
    expect(l.pursuitRate).toBe(0);
  });

  it("keeps a genuine total loss visible as zero rather than hiding it", () => {
    const [l] = breakdownLines([{ ...row, won: 0, lost: 4 }]);
    expect(l.winRate).toBe(0);
    expect(l.undecided).toBe(0);
  });

  it("never reports negative pending work when the counts disagree", () => {
    const [l] = breakdownLines([{ ...row, submitted: 1, won: 1, lost: 1 }]);
    expect(l.undecided).toBe(0);
  });

  it("defaults an unknown dimension to agency and rejects an array", () => {
    expect(parseBreakdown(undefined)).toBe("agency");
    expect(parseBreakdown("secrets")).toBe("agency");
    expect(parseBreakdown(["naics"])).toBe("agency");
    expect(parseBreakdown("score_band")).toBe("score_band");
    expect(breakdownLabel("set_aside")).toBe("Set-aside");
  });
});
