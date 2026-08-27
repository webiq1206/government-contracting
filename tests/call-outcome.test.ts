import { describe, expect, it } from "vitest";
import {
  CALL_OUTCOMES,
  CALL_OUTCOME_HINT,
  CALL_OUTCOME_LABEL,
  normalizeOutcome,
  outcomeComplete,
  outcomeEffect,
} from "../lib/domain/call-outcome";

describe("outcomeEffect", () => {
  it("covers every outcome, so none of them silently means nothing", () => {
    for (const o of CALL_OUTCOMES) {
      expect(CALL_OUTCOME_LABEL[o]).toBeTruthy();
      expect(CALL_OUTCOME_HINT[o]).toBeTruthy();
    }
  });

  it("leaves the pairing alone when nobody was reached", () => {
    /*
     * The important one. A ringing phone has told us nothing, and moving the
     * pairing to responsive on the strength of it is the platform inventing a
     * conversation that did not happen.
     */
    expect(outcomeEffect("no_answer").pairing).toBe("unchanged");
    expect(outcomeEffect("no_answer").closeOut).toBe(false);
  });

  it("does not record a refusal from a firm that was never reached", () => {
    // A wrong number is a contact record to fix, not a decision by the firm.
    const wrong = outcomeEffect("wrong_number");
    expect(wrong.pairing).toBe("unchanged");
    expect(wrong.closeOut).toBe(false);
    expect(wrong.contactBroken).toBe(true);
  });

  it("keeps the firm on the bid when the right person is somebody else", () => {
    const other = outcomeEffect("different_contact");
    expect(other.pairing).toBe("unchanged");
    expect(other.needsContactName).toBe(true);
  });

  it("closes out only the three answers that put a firm out of this trade", () => {
    const closing = CALL_OUTCOMES.filter((o) => outcomeEffect(o).closeOut);
    expect([...closing].sort()).toEqual(["does_not_perform", "not_qualified", "pass"]);
  });

  it("marks the two answers that are about the firm rather than the job", () => {
    const mismatch = CALL_OUTCOMES.filter((o) => outcomeEffect(o).capabilityMismatch);
    expect([...mismatch].sort()).toEqual(["does_not_perform", "not_qualified"]);
    // Passing on one job says nothing about whether they do the trade.
    expect(outcomeEffect("pass").capabilityMismatch).toBe(false);
  });

  it("flags partial scope so the rest of the trade still gets sourced", () => {
    const partial = outcomeEffect("partial_scope");
    expect(partial.pairing).toBe("responsive");
    expect(partial.partialCoverage).toBe(true);
  });

  it("changes nothing for an outcome it does not recognise", () => {
    /*
     * The safe reading of an unrecognised answer is that we learned nothing,
     * not that the firm declined. Getting that backwards takes a live
     * subcontractor off a bid on the strength of a typo.
     */
    for (const junk of ["", null, undefined, "banana", "DECLINED_MAYBE"]) {
      const e = outcomeEffect(junk);
      expect(e.pairing).toBe("unchanged");
      expect(e.closeOut).toBe(false);
    }
  });
});

describe("normalizeOutcome", () => {
  it("reads the five outcomes older records already carry", () => {
    expect(normalizeOutcome("success")).toBe("quote_provided");
    expect(normalizeOutcome("not_interested")).toBe("pass");
    expect(normalizeOutcome("declined")).toBe("pass");
  });

  it("passes current outcomes through untouched", () => {
    for (const o of CALL_OUTCOMES) expect(normalizeOutcome(o)).toBe(o);
  });

  it("does not turn a skip into an outcome", () => {
    // Skipping is the absence of a call, and the card status carries it. A
    // mapping here would show a call that never happened as one that did.
    expect(normalizeOutcome("skipped")).toBeNull();
  });

  it("returns null rather than guessing", () => {
    expect(normalizeOutcome("banana")).toBeNull();
    expect(normalizeOutcome("")).toBeNull();
    expect(normalizeOutcome(null)).toBeNull();
  });
});

describe("outcomeComplete", () => {
  it("refuses a call-back with no time", () => {
    const r = outcomeComplete("call_back_later", {});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/when to call back/i);
  });

  it("refuses a time that is only whitespace", () => {
    expect(outcomeComplete("call_back_later", { callBackAt: "   " }).ok).toBe(false);
  });

  it("accepts a call-back with a time", () => {
    expect(outcomeComplete("call_back_later", { callBackAt: "2026-09-02T07:00" }).ok).toBe(true);
  });

  it("refuses a different contact with no name", () => {
    // Otherwise it is the same call to make again tomorrow with the same
    // result, which is the failure the outcome exists to prevent.
    const r = outcomeComplete("different_contact", { contactName: "" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/Name the person/i);
  });

  it("asks nothing extra of the outcomes that carry no obligation", () => {
    for (const o of CALL_OUTCOMES) {
      const e = outcomeEffect(o);
      if (e.needsCallBackTime || e.needsContactName) continue;
      expect(outcomeComplete(o, {}).ok).toBe(true);
    }
  });
});
