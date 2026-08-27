import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  afterFailure,
  describeSave,
  draftDecision,
  draftKey,
  MAX_ATTEMPTS,
  RETRY_DELAYS_MS,
} from "../lib/domain/save-state";

/**
 * What happened to the work somebody typed.
 *
 * Every form in this product had the same two-variable version of this: a
 * `saving` boolean and an `error` string. That shape can say "working" and it
 * can say "something went wrong", and it cannot say the three things that
 * matter to somebody who has lost a connection halfway through writing up a
 * call: that the failure was the network rather than the record, that another
 * attempt is coming, and that the text is still here.
 */

describe("a save that did not go through", () => {
  it("calls a dead connection what it is, rather than a failure", () => {
    /*
     * "Save failed" on a laptop with the wifi off sends somebody to support
     * instead of to the wifi. It also burns the attempts: three retries
     * against a network that is not there prove nothing and end with a form
     * that has given up for the wrong reason.
     */
    expect(afterFailure({ attempt: 1, online: false })).toEqual({
      state: "offline",
      retryInMs: null,
    });
    expect(afterFailure({ attempt: 3, online: false }).state).toBe("offline");
  });

  it("schedules the next attempt, and says how long", () => {
    expect(afterFailure({ attempt: 1, online: true })).toEqual({
      state: "retrying",
      retryInMs: RETRY_DELAYS_MS[0],
    });
    expect(afterFailure({ attempt: 2, online: true }).retryInMs).toBe(RETRY_DELAYS_MS[1]);
    expect(afterFailure({ attempt: 3, online: true }).retryInMs).toBe(RETRY_DELAYS_MS[2]);
  });

  it("stops, rather than retrying forever", () => {
    /*
     * An interface that retries forever never tells anybody their work is not
     * saved. And the failures that need a person (a rejected field, an expired
     * session, a record somebody else deleted) are not the kind a fourth
     * attempt fixes.
     */
    expect(afterFailure({ attempt: MAX_ATTEMPTS, online: true })).toEqual({
      state: "failed",
      retryInMs: null,
    });
    expect(afterFailure({ attempt: 99, online: true }).state).toBe("failed");
  });
});

describe("the sentence beside the form", () => {
  it("says where the work is, every time it is not on the server", () => {
    // "Not saved" on its own reads as "gone", and the whole point of keeping
    // the draft is that it is not.
    for (const state of ["offline", "failed"] as const) {
      expect(describeSave(state).text).toContain("device");
    }
  });

  it("counts the attempt in seconds a person can wait out", () => {
    const d = describeSave("retrying", { attempt: 1, retryInMs: 6_000 });
    expect(d.text).toContain("6 seconds");
    expect(d.text).toContain(`attempt 2 of ${MAX_ATTEMPTS}`);
    expect(describeSave("retrying", { attempt: 1, retryInMs: 1_000 }).text).toContain("1 second");
  });

  it("repeats the server's own reason when it has one", () => {
    // A rejected save with a reason is a save the operator can fix. Throwing
    // that away and saying "not saved" turns a correctable field into a
    // mystery.
    expect(describeSave("failed", { reason: "Notes cannot exceed 10000 characters." }).text).toContain(
      "10000 characters"
    );
  });

  it("says nothing at all when there is nothing to say", () => {
    // A form that permanently displays a status is one whose status stops
    // being read.
    expect(describeSave("clean").text).toBe("");
  });

  it("marks the states where work is at risk, and the ones needing a person", () => {
    expect(describeSave("saved").atRisk).toBe(false);
    expect(describeSave("clean").atRisk).toBe(false);
    for (const state of ["unsaved", "saving", "offline", "retrying", "failed"] as const) {
      expect(describeSave(state).atRisk, state).toBe(true);
    }
    // Retrying and saving resolve themselves. The other two do not.
    expect(describeSave("retrying").needsOperator).toBe(false);
    expect(describeSave("saving").needsOperator).toBe(false);
    expect(describeSave("failed").needsOperator).toBe(true);
    expect(describeSave("unsaved").needsOperator).toBe(true);
  });
});

describe("a draft found on the device", () => {
  it("is offered, never applied", () => {
    /*
     * The record may have moved on since the draft was written, by somebody
     * else or by this operator on another device. Silently replacing what the
     * server holds with what a browser remembers is the version of this
     * feature that destroys work instead of saving it.
     */
    const d = draftDecision("the newer text", "what the server has");
    expect(d).toEqual({ action: "offer", draft: "the newer text" });
  });

  it("is not offered when it matches the record", () => {
    expect(draftDecision("same", "same")).toEqual({ action: "none" });
  });

  it("is not offered when both are empty in different ways", () => {
    // A stray "\n" left behind by a cleared field is not an edit worth
    // interrupting somebody about.
    expect(draftDecision("\n  ", "")).toEqual({ action: "none" });
  });

  it("does not confuse two records", () => {
    expect(draftKey("opportunity-notes", "a")).not.toBe(draftKey("opportunity-notes", "b"));
    expect(draftKey("opportunity-notes", "a")).toContain("brostco.draft.");
  });
});

describe("the hook that drives it", () => {
  const SRC = readFileSync("lib/use-draft.ts", "utf8");

  it("clears the device copy only on a confirmed save", () => {
    // Removing it anywhere else (on send, on unmount, on a state change) is
    // how a "draft preserved" feature loses the one draft it existed for.
    const afterSuccess = SRC.slice(SRC.indexOf('setState("saved")'));
    expect(afterSuccess).toContain("localStorage.removeItem(key)");
  });

  it("sends what is in the form now, not what failed", () => {
    /*
     * Somebody who kept typing through a failed save meant the newer text.
     * Retrying the captured older value would quietly undo the edits they made
     * while waiting, which is a data loss that looks like a success.
     */
    expect(SRC).toContain("send.current(latest.current)");
  });

  it("treats the connection returning as the retry", () => {
    expect(SRC).toContain('window.addEventListener("online"');
  });
});

describe("the indicator", () => {
  const SRC = readFileSync("components/save-status.tsx", "utf8");

  it("announces the change rather than only showing it", () => {
    // A save that resolves while somebody is reading the next field is exactly
    // the change a screen reader user gets no signal about.
    expect(SRC).toContain('aria-live="polite"');
    expect(SRC).toContain('role="status"');
  });

  it("offers a way out of the state that cannot resolve itself", () => {
    expect(SRC).toContain("Try again");
  });
});
