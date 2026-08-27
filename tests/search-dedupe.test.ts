/**
 * The same solicitation, ingested twice, showing up twice in search.
 *
 * The audit found duplicate opportunity records in global search. Two rows
 * for one job, at different stages, with nothing to say which one the work
 * had actually been done on -- so the operator picks one and finds an empty
 * record, or worse, works the wrong one.
 */
import { describe, it, expect } from "vitest";
import { dedupeOpportunityHits, type OppHit } from "@/lib/domain/search-dedupe";

const hit = (over: Partial<OppHit>): OppHit => ({
  id: "a",
  title: "Roof replacement",
  agency: "GSA",
  solicitation_number: "SP-2026-001",
  stage: "outreach",
  status: "open",
  ...over,
});

describe("dedupeOpportunityHits", () => {
  it("collapses the same solicitation and says how many were folded in", () => {
    const out = dedupeOpportunityHits([
      hit({ id: "a" }),
      hit({ id: "b", status: "archived" }),
      hit({ id: "c", status: "archived" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("a");
    expect(out[0].duplicates).toBe(2);
  });

  it("keeps the open record over an archived one", () => {
    // The query orders open-first, but a re-ingested notice can arrive in any
    // order; the record being worked is the one the operator meant.
    const out = dedupeOpportunityHits([
      hit({ id: "old", status: "archived" }),
      hit({ id: "live", status: "open" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("live");
    expect(out[0].duplicates).toBe(1);
  });

  it("matches regardless of spacing and case in the solicitation number", () => {
    const out = dedupeOpportunityHits([
      hit({ id: "a", solicitation_number: "SP-2026-001" }),
      hit({ id: "b", solicitation_number: "  sp-2026-001 " }),
    ]);
    expect(out).toHaveLength(1);
  });

  it("never merges records that have no solicitation number", () => {
    /*
     * Two manual entries sharing a title are not evidence of a duplicate,
     * and merging them would silently hide one of them. Only the
     * government's own identifier is trusted for this.
     */
    const out = dedupeOpportunityHits([
      hit({ id: "a", solicitation_number: null }),
      hit({ id: "b", solicitation_number: null }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.every((o) => o.duplicates === 0)).toBe(true);
  });

  it("leaves genuinely different solicitations alone", () => {
    const out = dedupeOpportunityHits([
      hit({ id: "a", solicitation_number: "SP-2026-001" }),
      hit({ id: "b", solicitation_number: "SP-2026-002" }),
    ]);
    expect(out).toHaveLength(2);
  });
});

/**
 * A folded duplicate has to be reachable, not merely counted.
 *
 * Collapsing is right for somebody jumping to the record they are working.
 * But three copies of one solicitation at three different stages is a data
 * problem, and a count with nowhere to click is that problem stated and then
 * withheld: the operator can see there are two more and cannot see which
 * stage either of them is at.
 */
describe("the copies that were folded", () => {
  it("counts every copy, including the one that survived", () => {
    const rows = dedupeOpportunityHits([
      { id: "a", title: "Roof", agency: "GSA", solicitation_number: "SOL-1", stage: "pricing", status: "open" },
      { id: "b", title: "Roof", agency: "GSA", solicitation_number: "SOL-1", stage: "watching", status: "archived" },
      { id: "c", title: "Roof", agency: "GSA", solicitation_number: "SOL-1", stage: "watching", status: "archived" },
    ]);
    expect(rows).toHaveLength(1);
    // Two folded, so three copies exist. The row that survived is the one
    // carrying the work.
    expect(rows[0].duplicates).toBe(2);
    expect(rows[0].id).toBe("a");
  });
});
