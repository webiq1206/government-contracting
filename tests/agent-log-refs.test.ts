/**
 * Which record a run's log line is attached to.
 *
 * The runner writes the line that carries an agent's summary and reasoning,
 * and it tagged only the opportunity. `sub-verify` therefore wrote "Seed 001
 * Electric ruled out: located in NY, work is in TX" against no subcontractor
 * at all, and `subActivityLogs` selects on `subcontractor_id`, so the one
 * place an operator goes to ask what happened to a subcontractor could not
 * show the sentence that answers it. The same sentence appeared on the
 * opportunity, which is why nothing looked broken.
 *
 * The org-mismatch log four lines above it already tagged both, which is what
 * marks this as an oversight rather than a decision.
 */
import { describe, expect, it } from "vitest";
import { recordRefs } from "@/lib/agents/runner";

describe("the records a run's log points at", () => {
  it("carries both ids when the payload names both", () => {
    expect(recordRefs({ opportunityId: "opp-1", subcontractorId: "sub-1" })).toEqual({
      opportunityId: "opp-1",
      subcontractorId: "sub-1",
    });
  });

  it("carries the subcontractor even when there is no opportunity", () => {
    // The roster-wide sweeps work this way: a subcontractor and no bid.
    expect(recordRefs({ subcontractorId: "sub-1" })).toEqual({
      opportunityId: null,
      subcontractorId: "sub-1",
    });
  });

  it("uses null rather than undefined for an id the payload does not have", () => {
    /*
     * The distinction matters at the insert: undefined would be dropped from
     * the parameter list and shift every column after it.
     */
    expect(recordRefs({})).toEqual({ opportunityId: null, subcontractorId: null });
  });

  it("does not invent an id from an unrelated payload key", () => {
    expect(recordRefs({ contractId: "c-1", bidId: "b-1" })).toEqual({
      opportunityId: null,
      subcontractorId: null,
    });
  });
});
