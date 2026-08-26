import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * A reply about one trade must not settle the others.
 *
 * A subcontractor is often on a bid for several trades. When their reply names
 * one, that is the one it is about. When it names none, the product used to
 * stamp EVERY trade line on the pairing, defended in a comment on the grounds
 * that "we can't take this on" and "we're in" are answers about the whole job.
 *
 * Sometimes they are. But a firm paired to HVAC, Electrical and Plumbing who
 * writes "we're in" got two trades marked responsive that nobody had committed
 * to, and the coverage graph then read as satisfied for work with no quote
 * behind it. Read as a decline, the same sentence wrote off two trades on one
 * ambiguous line.
 *
 * Either direction is a guess about which trades a person meant.
 */

const ROWS: { trade: string | null }[] = [];
const UPDATES: { sql: string; params: unknown[] }[] = [];
vi.mock("../lib/db", () => ({
  query: async (sql: string, params: unknown[] = []) => {
    if (/select distinct trade/.test(sql)) return ROWS;
    UPDATES.push({ sql, params });
    return [];
  },
}));

const { applyOutcomeToSolicitation } = await import("../lib/domain/reply-outcome");

const apply = (trade: string | null) =>
  applyOutcomeToSolicitation({
    opportunityId: "opp-1",
    subcontractorId: "sub-1",
    trade,
    outcome: "interested",
  });

beforeEach(() => {
  ROWS.length = 0;
  UPDATES.length = 0;
});

describe("which trade lines a reply may change", () => {
  it("applies to the one trade the reply named", () => {
    ROWS.push({ trade: "HVAC" }, { trade: "Electrical" }, { trade: "Plumbing" });
    return apply("HVAC").then((r) => {
      expect(r.applied).toBe(true);
      const update = UPDATES.find((u) => /update opportunity_subs/.test(u.sql));
      expect(update?.params).toContain("HVAC");
    });
  });

  it("applies to the only trade when the pairing has one", async () => {
    // The message did not name it, and it does not have to: there is only one
    // answer it could be about.
    ROWS.push({ trade: "Electrical" });
    const r = await apply(null);
    expect(r.applied).toBe(true);
    expect(UPDATES.some((u) => /update opportunity_subs/.test(u.sql))).toBe(true);
  });

  it("changes nothing when several trades are paired and the reply named none", async () => {
    ROWS.push({ trade: "HVAC" }, { trade: "Electrical" }, { trade: "Plumbing" });
    const r = await apply(null);
    expect(r.applied).toBe(false);
    expect(r.refused).toBe("ambiguous_trade");
    // Not a single write. The point is that nothing is claimed, not that the
    // claim is made quietly.
    expect(UPDATES).toEqual([]);
  });

  it("names the trades it could have meant, for the person who has to decide", async () => {
    ROWS.push({ trade: "HVAC" }, { trade: "Electrical" });
    const r = await apply(null);
    expect(r.candidateTrades).toEqual(["HVAC", "Electrical"]);
  });

  it("still applies to a pairing with one untraded line", async () => {
    // A generic pairing with no trade at all is one relationship, not many,
    // so there is nothing ambiguous about it.
    ROWS.push({ trade: null });
    const r = await apply(null);
    expect(r.applied).toBe(true);
  });

  it("writes nothing for an outcome that has no state", async () => {
    ROWS.push({ trade: "HVAC" });
    const r = await applyOutcomeToSolicitation({
      opportunityId: "opp-1",
      subcontractorId: "sub-1",
      trade: "HVAC",
      outcome: "unclear",
    });
    expect(r.applied).toBe(false);
    expect(r.refused).toBe("no_state_for_outcome");
    expect(UPDATES).toEqual([]);
  });
});
