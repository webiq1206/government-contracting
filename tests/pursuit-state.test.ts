/**
 * Whether automation may act on an opportunity.
 *
 * The product could dismiss an opportunity and could move its stage. Neither
 * stops work already in flight, so a queued follow-up still went out and a
 * recovery sweep still re-enqueued scoring for a bid nobody was submitting.
 * From the subcontractor's side that is an email about an abandoned job, over
 * the operator's name, days later.
 */
import { describe, it, expect } from "vitest";
import {
  parsePursuitState,
  pursuitVerdict,
  abortRequestProblem,
  isAbortReason,
  ABORT_REASONS,
  ABORT_REASON_LABEL,
  RESTART_REVALIDATION,
} from "../lib/domain/pursuit-state";

describe("parsePursuitState", () => {
  it("reads the three real states", () => {
    expect(parsePursuitState("active")).toBe("active");
    expect(parsePursuitState("paused")).toBe("paused");
    expect(parsePursuitState("aborted")).toBe("aborted");
  });

  it("treats anything it does not recognise as stopped", () => {
    /*
     * The direction of this default is the whole point. A column written by a
     * future migration, a typo, a value from a restore: each means this code
     * does not know what it is looking at. Reading an unknown state as active
     * would resume outreach on the strength of not understanding the record.
     */
    for (const bad of [null, undefined, "", "ACTIVE", "running", 1, {}, "activ"]) {
      expect(parsePursuitState(bad), `${JSON.stringify(bad)} must not read as active`).toBe(
        "aborted"
      );
    }
  });
});

describe("pursuitVerdict", () => {
  it("lets an active pursuit act, with nothing to explain", () => {
    expect(pursuitVerdict({ state: "active" })).toEqual({ mayAct: true, reason: null });
  });

  it("stops a paused pursuit and says it is resumable", () => {
    const v = pursuitVerdict({ state: "paused" });
    expect(v.mayAct).toBe(false);
    expect(v.reason).toMatch(/paused/i);
    expect(v.reason).toMatch(/preserved/i);
  });

  it("stops an aborted pursuit and says restarting is not resuming", () => {
    // The distinction that stops somebody expecting a one-click resume: the
    // solicitation may have been amended twice since.
    const v = pursuitVerdict({ state: "aborted" });
    expect(v.mayAct).toBe(false);
    expect(v.reason).toMatch(/revalidation/i);
    expect(v.reason).toMatch(/history is kept/i);
  });

  it("carries the operator's reason into the explanation", () => {
    const v = pursuitVerdict({ state: "aborted", reason: "deadline_unreachable" });
    expect(v.reason).toContain("deadline_unreachable");
  });

  it("does not look at stage, deadline or readiness", () => {
    /*
     * Permission and progress are different questions. Mixing them is how a
     * guard grows an exception that lets one caller through.
     */
    const withExtras = pursuitVerdict({
      state: "aborted",
      // deliberately passing nothing else: the type has nothing else to pass
    });
    expect(withExtras.mayAct).toBe(false);
  });
});

describe("abort reasons", () => {
  it("labels every reason it offers", () => {
    for (const r of ABORT_REASONS) {
      expect(ABORT_REASON_LABEL[r], `no label for ${r}`).toBeTruthy();
    }
  });

  it("recognises its own reasons and nothing else", () => {
    expect(isAbortReason("agency_cancelled")).toBe(true);
    expect(isAbortReason("because_i_said_so")).toBe(false);
    expect(isAbortReason(null)).toBe(false);
  });

  it("requires a reason", () => {
    expect(abortRequestProblem({})).toMatch(/Choose a reason/);
    expect(abortRequestProblem({ reason: "nonsense" })).toMatch(/Choose a reason/);
  });

  it("requires a note when the reason is Other", () => {
    // "Other" is what somebody picks when none of the rest fit, so it is both
    // the one that most needs the sentence and the easiest to leave blank.
    expect(abortRequestProblem({ reason: "other" })).toMatch(/Describe the reason/);
    expect(abortRequestProblem({ reason: "other", note: "  " })).toMatch(/Describe the reason/);
    expect(abortRequestProblem({ reason: "other", note: "Owner pulled out" })).toBeNull();
  });

  it("accepts a structured reason without a note", () => {
    expect(abortRequestProblem({ reason: "pricing_unacceptable" })).toBeNull();
  });
});

describe("restart revalidation", () => {
  it("names the checks rather than leaving them to the caller", () => {
    // Named in one place so the restart path and the confirmation screen
    // cannot drift into describing different work.
    expect(RESTART_REVALIDATION.length).toBeGreaterThan(3);
    expect(RESTART_REVALIDATION.join(" ")).toMatch(/amendment/i);
    expect(RESTART_REVALIDATION.join(" ")).toMatch(/without approval/i);
  });
});
