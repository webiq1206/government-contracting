import { describe, expect, it } from "vitest";
import {
  opportunityMutationProblem,
  outcomeDetailsProblem,
  outcomeProblem,
  sendProblem,
} from "@/lib/domain/opportunity-lifecycle";

describe("opportunity mutation lifecycle", () => {
  const active = {
    stage: "bid_building",
    status: "open",
    pursuitState: "active",
    submissionState: "package_ready",
  };

  it("allows draft work only while the pursuit is active and open", () => {
    expect(opportunityMutationProblem(active, "bid_build")).toBeNull();
    expect(
      opportunityMutationProblem({ ...active, status: "archived" }, "bid_build")
    ).toMatch(/read-only/i);
    expect(
      opportunityMutationProblem({ ...active, pursuitState: "paused" }, "bid_build")
    ).toMatch(/resume/i);
    expect(
      opportunityMutationProblem({ ...active, pursuitState: "aborted" }, "bid_build")
    ).toMatch(/restart/i);
  });

  it("locks approved and sent artifacts against pricing, quote, and build changes", () => {
    for (const submissionState of ["approved", "sent", "receipt_confirmed"]) {
      for (const mutation of ["quote", "pricing", "bid_build"] as const) {
        expect(
          opportunityMutationProblem({ ...active, submissionState }, mutation),
          `${submissionState} ${mutation}`
        ).toMatch(/locked|approved/i);
      }
    }
  });

  it("limits quote and pricing changes to the quote portion of the workflow", () => {
    expect(
      opportunityMutationProblem({ ...active, stage: "analysis" }, "pricing")
    ).toMatch(/after subcontractor outreach/i);
    expect(
      opportunityMutationProblem({ ...active, stage: "outreach" }, "quote")
    ).toBeNull();
  });

  it("does not mutate submitted, terminal, or unknown workflow states", () => {
    expect(
      opportunityMutationProblem({ ...active, stage: "submitted" }, "manual_move")
    ).toMatch(/already submitted/i);
    expect(
      opportunityMutationProblem({ ...active, stage: "won" }, "manual_move")
    ).toMatch(/final outcome/i);
    expect(
      opportunityMutationProblem({ ...active, stage: "future_state" }, "manual_move")
    ).toMatch(/unknown workflow state/i);
  });
});

describe("send lifecycle", () => {
  const approved = {
    stage: "bid_building",
    status: "open",
    pursuitState: "active",
    submissionState: "approved",
  };

  it("allows delivery evidence only for the active approved package", () => {
    expect(sendProblem(approved)).toBeNull();
    expect(sendProblem({ ...approved, submissionState: "package_ready" })).toMatch(
      /approve the package first/i
    );
    expect(sendProblem({ ...approved, stage: "quote_entry" })).toMatch(/finish its review/i);
    expect(sendProblem({ ...approved, pursuitState: "paused" })).toMatch(/resume/i);
    expect(sendProblem({ ...approved, status: "closed" })).toMatch(/cannot be marked as sent/i);
  });
});

describe("outcome lifecycle", () => {
  const sent = {
    stage: "submitted",
    status: "open",
    pursuitState: "active",
    submissionState: "sent",
  };

  it("requires a sent bid that is still awaiting an agency result", () => {
    expect(outcomeProblem(sent, "won")).toBeNull();
    expect(outcomeProblem({ ...sent, stage: "bid_building" }, "won")).toMatch(
      /only after the bid has been sent/i
    );
    expect(outcomeProblem({ ...sent, submissionState: "approved" }, "lost")).toMatch(
      /no completed send record/i
    );
    expect(outcomeProblem({ ...sent, submissionState: "rejected" }, "won")).toMatch(
      /rejected submission cannot be marked won/i
    );
  });

  it("requires the contract facts that a win creates", () => {
    const complete = {
      outcome: "won" as const,
      awardAmount: 125_000,
      contractNumber: "W91234-26-C-0001",
      startDate: "2026-10-01",
      endDate: "2027-09-30",
    };
    expect(outcomeDetailsProblem(complete)).toBeNull();
    expect(outcomeDetailsProblem({ ...complete, awardAmount: null })).toMatch(/dollar amount/i);
    expect(outcomeDetailsProblem({ ...complete, contractNumber: "" })).toMatch(/award number/i);
    expect(outcomeDetailsProblem({ ...complete, endDate: "2026-09-30" })).toMatch(
      /cannot be before/i
    );
  });

  it("requires a useful reason for a loss or no-award result", () => {
    expect(
      outcomeDetailsProblem({ outcome: "lost", lossReason: "Price was above the awardee." })
    ).toBeNull();
    expect(outcomeDetailsProblem({ outcome: "lost", lossReason: "price" })).toMatch(
      /explain why/i
    );
    expect(outcomeDetailsProblem({ outcome: "no_award", lossReason: "" })).toMatch(
      /no award/i
    );
  });
});
