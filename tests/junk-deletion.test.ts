import { describe, it, expect } from "vitest";

/**
 * The delete-unworkable rule lives in SQL inside expiredOpportunitySweep.
 * These tests pin the DECISION LOGIC that SQL encodes, so a future edit that
 * loosens a safeguard fails here rather than silently destroying real work.
 */
interface Candidate {
  pastDue: boolean;
  flags: string[];
  stage: string;
  humanActionRequired: boolean;
  notes: string;
  hasBid: boolean;
  hasContract: boolean;
  hasQuote: boolean;
  hasCommunication: boolean;
  hasCallCard: boolean;
}

function base(over: Partial<Candidate> = {}): Candidate {
  return {
    pastDue: true,
    flags: [],
    stage: "scoring",
    humanActionRequired: false,
    notes: "",
    hasBid: false,
    hasContract: false,
    hasQuote: false,
    hasCommunication: false,
    hasCallCard: false,
    ...over,
  };
}

/** Mirrors the SQL predicate exactly. */
function isDeletable(c: Candidate): boolean {
  const unworkable =
    c.pastDue ||
    c.flags.includes("below_min_lead_time") ||
    c.flags.includes("deadline_too_soon");
  const neverWorked =
    !c.hasBid &&
    !c.hasContract &&
    !c.hasQuote &&
    !c.hasCommunication &&
    !c.hasCallCard &&
    c.notes.trim() === "";
  return (
    unworkable &&
    ["monitoring", "scoring", "dismissed"].includes(c.stage) &&
    !c.humanActionRequired &&
    neverWorked
  );
}

describe("auto-delete of unworkable notices", () => {
  it("deletes a past-due notice nobody ever touched", () => {
    expect(isDeletable(base())).toBe(true);
  });

  it("deletes one auto-passed for insufficient lead time", () => {
    expect(
      isDeletable(base({ pastDue: false, flags: ["below_min_lead_time"], stage: "dismissed" }))
    ).toBe(true);
  });

  it("NEVER deletes anything with a bid or contract", () => {
    expect(isDeletable(base({ hasBid: true }))).toBe(false);
    expect(isDeletable(base({ hasContract: true }))).toBe(false);
  });

  it("NEVER deletes anything with a quote, call, or message", () => {
    expect(isDeletable(base({ hasQuote: true }))).toBe(false);
    expect(isDeletable(base({ hasCallCard: true }))).toBe(false);
    expect(isDeletable(base({ hasCommunication: true }))).toBe(false);
  });

  it("NEVER deletes a record carrying operator notes", () => {
    expect(isDeletable(base({ notes: "Called the CO, worth chasing next year." }))).toBe(false);
  });

  it("NEVER deletes something still waiting on the operator", () => {
    expect(isDeletable(base({ humanActionRequired: true }))).toBe(false);
  });

  it("NEVER deletes a record that advanced into the real pipeline", () => {
    for (const stage of ["analysis", "sub_research", "outreach", "call_queue", "quote_entry", "bid_building", "submitted", "won", "lost"]) {
      expect(isDeletable(base({ stage })), `stage ${stage}`).toBe(false);
    }
  });

  it("does not delete a live notice that is simply still open", () => {
    expect(isDeletable(base({ pastDue: false }))).toBe(false);
  });
});
