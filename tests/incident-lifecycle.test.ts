import { describe, expect, it } from "vitest";
import {
  canTransition,
  describePlan,
  INCIDENT_STATES,
  isOpen,
  parseIncidentState,
  planReplay,
  replayDecision,
  replayKey,
  type IncidentState,
  type JobFailure,
} from "../lib/domain/incident";
import { classifyFailure } from "../lib/domain/automation-health";

const failure = (over: Partial<JobFailure> = {}): JobFailure => ({
  id: "run-1",
  agent: "scoring-engine",
  opportunityId: "opp-1",
  failedAt: new Date("2026-08-26T10:00:00Z"),
  error: "Your credit balance is too low to access the API",
  ...over,
});

describe("the incident lifecycle", () => {
  it("cannot reach recovered without work having run", () => {
    /*
     * The whole point of the machine. An incident is not over because somebody
     * funded the account, or because the page looks calmer. It is over when
     * the queue drained and a downstream record changed.
     */
    for (const from of INCIDENT_STATES) {
      if (from === "backlog_draining" || from === "test_passed") continue;
      expect(canTransition(from, "recovered"), from).toBe(false);
    }
    expect(canTransition("backlog_draining", "recovered")).toBe(true);
  });

  it("keeps provider restored and test passed as separate facts", () => {
    // "The card went through" and "a request to the model came back" are
    // different, and treating the first as the second is what puts an account
    // back to work while every job still fails.
    expect(canTransition("detected", "test_passed")).toBe(false);
    expect(canTransition("provider_restored", "test_passed")).toBe(true);
  });

  it("lets a test pass straight to recovered when there is no backlog", () => {
    // An outage caught before anything queued has nothing to drain, and
    // forcing it through a requeue it does not need would leave it open.
    expect(canTransition("test_passed", "recovered")).toBe(true);
  });

  it("never reopens a recovered incident", () => {
    /*
     * A later outage is a new incident. Merging them would lose the fact that
     * the first one was fixed, which is the fact somebody will want when the
     * same thing happens a third time.
     */
    for (const to of INCIDENT_STATES) {
      expect(canTransition("recovered", to), to).toBe(false);
    }
  });

  it("lets a failed recovery be worked again", () => {
    expect(canTransition("recovery_failed", "mitigating")).toBe(true);
    expect(canTransition("recovery_failed", "provider_restored")).toBe(true);
    expect(canTransition("recovery_failed", "recovered")).toBe(false);
  });

  it("treats recovered and retired as closed", () => {
    for (const s of INCIDENT_STATES) {
      expect(isOpen(s), s).toBe(s !== "recovered" && s !== "retired");
    }
  });

  it("lets a turned-off integration leave any open state without claiming recovery", () => {
    for (const from of INCIDENT_STATES) {
      expect(canTransition(from, "retired"), from).toBe(from !== "recovered" && from !== "retired");
    }
    expect(canTransition("retired", "recovered")).toBe(false);
    expect(canTransition("retired", "detected")).toBe(false);
  });

  it("reads an unrecognised state as still needing a person", () => {
    // Reading an unknown value as "recovered" would close an incident nobody
    // fixed, which is the one wrong answer that hides itself.
    for (const bad of [null, undefined, "", "fine", 7]) {
      expect(parseIncidentState(bad)).toBe("detected");
    }
    expect(parseIncidentState("BACKLOG_DRAINING")).toBe("backlog_draining");
  });
});

describe("deciding what is safe to replay", () => {
  const cause = "provider_credit";

  it("replays an ordinary failure from the same cause", () => {
    const d = replayDecision(failure(), cause);
    expect(d.eligible).toBe(true);
    expect(d.reason).toBeNull();
  });

  it("never replays outward-facing work in bulk", () => {
    /*
     * Replaying a scoring run costs a few cents. Replaying an outreach send
     * puts a second email in a subcontractor's inbox, and "it failed the first
     * time" does not make that safe, because the failure could have been AFTER
     * the message left.
     */
    for (const agent of ["outreach", "outreach-followup", "sources-sought-responder"]) {
      const d = replayDecision(failure({ agent }), cause);
      expect(d.eligible, agent).toBe(false);
      expect(d.reason).toBe("unsafe_to_replay");
    }
  });

  it.each([
    [{ recordMissing: true }, "record_gone"],
    [{ pursuitStopped: true }, "pursuit_stopped"],
    [{ deadlinePassed: true }, "deadline_passed"],
    [{ supersededBySuccess: true }, "superseded"],
    [{ manuallyResolved: true }, "manually_resolved"],
    [{ alreadyRequeued: true }, "already_requeued"],
  ])("refuses %j", (context, reason) => {
    const d = replayDecision(failure(), cause, context);
    expect(d.eligible).toBe(false);
    expect(d.reason).toBe(reason);
  });

  it("reports the most conclusive reason when several apply", () => {
    // An operator reading "the deadline has already passed" should not be left
    // wondering whether it was also superseded.
    const d = replayDecision(failure(), cause, {
      alreadyRequeued: true,
      recordMissing: true,
      deadlinePassed: true,
    });
    expect(d.reason).toBe("already_requeued");
  });

  it("refuses a failure that had a different cause", () => {
    // Replay runs only after the provider answered. A mailbox failure is
    // still a different problem. A rate limit during the same outage is not.
    const other = replayDecision(failure({ error: "Gmail 429 too many requests" }), cause);
    expect(other.eligible).toBe(false);
    expect(other.reason).toBe("different_cause");
    const sibling = replayDecision(
      failure({ error: "OpenAI provider refusal (HTTP 429): rate limiting this account" }),
      cause
    );
    expect(sibling.eligible).toBe(true);
    expect(sibling.reason).toBeNull();
  });
});

describe("one classifier, not two", () => {
  it("files a failure under the same cause the health model would", () => {
    /*
     * This module used to carry its own classifier. Two answers to one
     * question drift, and the drift is silent and total: an error that health
     * files under `provider_credit` and recovery files under `other` belongs
     * to an incident it can never be replayed into, so the backlog sits there
     * looking like it is not draining.
     *
     * The test is against the shared function, so it fails the day somebody
     * adds a second one back.
     */
    for (const [error, cause] of [
      ["Your credit balance is too low", "provider_credit"],
      ["401 authentication_error: invalid x-api-key", "provider_auth"],
      ["429 rate limit", "provider_rate_limit"],
    ] as const) {
      expect(classifyFailure(error)).toBe(cause);
      // And the eligibility check agrees with it, which is the property that
      // actually matters.
      expect(replayDecision(failure({ error }), cause).eligible).toBe(true);
      expect(replayDecision(failure({ error }), "network").reason).toBe("different_cause");
    }
  });
});

describe("what a recovery would do, before it does it", () => {
  it("says how many will run and why the rest will not", () => {
    // "412 failures" is not something to decide against. "38 will run again,
    // 374 will not, and here is why" is.
    const plan = planReplay([
      replayDecision(failure({ id: "a" }), "provider_credit"),
      replayDecision(failure({ id: "b" }), "provider_credit"),
      replayDecision(failure({ id: "c" }), "provider_credit", { deadlinePassed: true }),
      replayDecision(failure({ id: "d", agent: "outreach" }), "provider_credit"),
      replayDecision(failure({ id: "e" }), "provider_credit", { deadlinePassed: true }),
    ]);
    expect(plan.eligible.map((f) => f.id)).toEqual(["a", "b"]);
    expect(plan.skippedByReason).toEqual({ deadline_passed: 2, unsafe_to_replay: 1 });
    const line = describePlan(plan);
    expect(line).toContain("2 of 5 will run again");
    expect(line).toContain("2 because the deadline has already passed");
    expect(line).toContain("1 because replaying it could send something twice");
  });

  it("says so plainly when there is nothing to retry", () => {
    expect(describePlan(planReplay([]))).toBe(
      "No failures from this incident are left to retry."
    );
  });

  it("says nothing about reasons when everything is eligible", () => {
    const plan = planReplay([replayDecision(failure(), "provider_credit")]);
    expect(describePlan(plan)).toBe("1 of 1 will run again.");
  });
});

describe("why a recovery skips a job", () => {
  it("counts one skipped job per reason, and keeps a sibling provider refusal eligible", () => {
    /*
     * planReplay adds one to skippedByReason for each decision. A later
     * success is "already done". A stopped pursuit, Sources Sought, and a
     * mailbox or database failure are different reasons. A rate limit or
     * auth failure during the same provider outage is not: the provider
     * has already answered, which is what made the replay safe.
     */
    const decisions = [
      replayDecision(failure({ id: "done", error: "credit balance too low" }), "provider_credit", {
        supersededBySuccess: true,
      }),
      replayDecision(failure({ id: "stopped" }), "provider_credit", { pursuitStopped: true }),
      replayDecision(failure({ id: "sought", agent: "sources-sought-responder" }), "provider_credit", {
        sourcesSought: true,
      }),
      replayDecision(failure({ id: "gmail", error: "Gmail 429 too many requests" }), "provider_credit"),
      replayDecision(
        failure({ id: "sibling", error: "OpenAI provider refusal (HTTP 429): rate limiting this account" }),
        "provider_credit"
      ),
      replayDecision(failure({ id: "auth", error: "401 invalid api key" }), "provider_credit"),
      replayDecision(failure({ id: "db", error: "remaining connection slots are reserved" }), "provider_credit"),
    ];
    const plan = planReplay(decisions);
    expect(plan.total).toBe(7);
    expect(plan.eligible.map((job) => job.id).sort()).toEqual(["auth", "sibling"]);
    expect(plan.skippedByReason).toEqual({
      superseded: 1,
      pursuit_stopped: 1,
      market_research: 1,
      different_cause: 2,
    });
    expect(plan.skippedByReason.superseded).toBe(
      decisions.filter((d) => d.reason === "superseded").length
    );
  });
});

describe("the idempotency key", () => {
  it("is the same for the same job in the same recovery", () => {
    // A second press of the button must not queue the work twice.
    expect(replayKey("inc-1", failure())).toBe(replayKey("inc-1", failure()));
  });

  it("differs per job and per incident", () => {
    /*
     * Both halves matter. Without the job id the whole recovery collapses into
     * one key and only one job runs. Without the incident id a second outage
     * months later could never replay the same job at all.
     */
    expect(replayKey("inc-1", failure({ id: "a" }))).not.toBe(
      replayKey("inc-1", failure({ id: "b" }))
    );
    expect(replayKey("inc-1", failure())).not.toBe(replayKey("inc-2", failure()));
  });
});
