import { describe, expect, it } from "vitest";
import {
  REQUIREMENT_STATES,
  canAutoComplete,
  checkStateChange,
  clarificationCount,
  defaultVerification,
  needsClarification,
  parseRequirementState,
  parseVerification,
  requirementDueState,
  requirementProgress,
  type RequirementState,
} from "../lib/domain/requirement-state";

/**
 * The rule the brief states outright: never mark an unverified extracted
 * requirement complete automatically when a human signature, credential,
 * upload, or portal action is required.
 *
 * Automation can tell you a form is attached. It cannot tell you somebody
 * signed it, holds the licence, or logged into the portal and pressed submit.
 * A checklist that ticks those on its own is one that gets a bid thrown out
 * while reading as complete, which is the worst of both.
 */

describe("what automation may close", () => {
  it("refuses all four kinds a person has to attest to", () => {
    for (const kind of ["signature", "credential", "upload", "portal_action"] as const) {
      const v = canAutoComplete({ verification: kind, humanVerified: true });
      expect(v.allowed, kind).toBe(false);
      expect(v.reason, kind).toBeTruthy();
    }
  });

  it("refuses a requirement nobody has verified, even when nothing needs proving", () => {
    /*
     * Subtler and it matters as much: an extracted requirement is a model's
     * reading of a document, and completing it automatically means the same
     * reading both created the obligation and discharged it.
     */
    const v = canAutoComplete({ verification: "none", humanVerified: false });
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain("nobody has confirmed the reading");
  });

  it("allows the one case that is actually checkable", () => {
    expect(canAutoComplete({ verification: "none", humanVerified: true }).allowed).toBe(true);
  });
});

describe("who may move a requirement where", () => {
  const base = { from: "in_progress" as RequirementState, verification: "signature" as const, humanVerified: true };

  it("lets a person do anything, because they can see the document", () => {
    expect(checkStateChange({ ...base, to: "done", by: "person" }).ok).toBe(true);
    expect(checkStateChange({ ...base, to: "not_applicable", by: "person" }).ok).toBe(true);
  });

  it("stops automation completing what needs a signature", () => {
    const r = checkStateChange({ ...base, to: "done", by: "automation" });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("signature");
  });

  it("never lets automation decide a requirement does not apply", () => {
    /*
     * That is a judgement about this company and this solicitation, and
     * getting it wrong looks identical to getting it right until the bid is
     * rejected.
     */
    const r = checkStateChange({
      ...base,
      verification: "none",
      to: "not_applicable",
      by: "automation",
    });
    expect(r.ok).toBe(false);
  });

  it("lets automation move a requirement along short of closing it", () => {
    expect(
      checkStateChange({ ...base, to: "blocked", by: "automation" }).ok
    ).toBe(true);
  });
});

describe("reading values that arrived from outside", () => {
  it("never reads an unknown state as done", () => {
    // The wrong direction here is a bid submitted without a requirement.
    expect(parseRequirementState("done_ish")).toBe("not_started");
    expect(parseRequirementState(undefined)).toBe("not_started");
    for (const s of REQUIREMENT_STATES) expect(parseRequirementState(s)).toBe(s);
  });

  it("never reads an unknown verification as nothing to prove", () => {
    /*
     * The safe direction is asking a person for something unnecessary. The
     * unsafe one is quietly deciding nobody needs to be asked.
     */
    expect(parseVerification("who knows")).toBe("upload");
    expect(parseVerification(null)).toBe("upload");
    expect(parseVerification("none")).toBe("none");
  });
});

describe("progress", () => {
  const r = (state: RequirementState) => ({ state });

  it("counts a decision that something does not apply as settled", () => {
    const p = requirementProgress([r("done"), r("not_applicable"), r("in_progress"), r("blocked")]);
    expect(p).toEqual({ settled: 2, total: 4, percent: 50 });
  });

  it("gives no percentage at all when nothing was extracted", () => {
    // Nothing extracted is not "no progress", it is no checklist, and the two
    // must not render the same way.
    expect(requirementProgress([]).percent).toBeNull();
  });

  it("does not count in-progress as half done", () => {
    expect(requirementProgress([r("in_progress"), r("in_progress")]).percent).toBe(0);
  });
});

describe("the clarification group", () => {
  it("is its own list rather than a flavour of blocked", () => {
    /*
     * The action is different: a blocked item needs work, and this one needs
     * somebody to ask the contracting officer a question, which takes days
     * this bid may not have.
     */
    const items = [
      { id: "a", state: "blocked" as RequirementState },
      { id: "b", state: "needs_clarification" as RequirementState },
    ];
    expect(needsClarification(items).map((x) => x.id)).toEqual(["b"]);
  });
});

describe("defaultVerification", () => {
  it("asks for a signature when the extraction said one is required", () => {
    expect(defaultVerification({ needsSignature: true, producedByPlatform: false })).toBe(
      "signature"
    );
  });

  it("still asks for a signature on an item the platform produces", () => {
    // The platform can generate the form. It cannot sign it, and an item that
    // needs a wet signature must never fall into the bucket automation may
    // close by itself.
    expect(defaultVerification({ needsSignature: true, producedByPlatform: true })).toBe(
      "signature"
    );
  });

  it("lets the platform check what the platform produces", () => {
    expect(defaultVerification({ producedByPlatform: true })).toBe("none");
  });

  it("defaults to needing a document when the extraction said nothing", () => {
    // The strict direction. Asking for something unnecessary costs a minute;
    // not asking costs the bid.
    expect(defaultVerification({ producedByPlatform: false })).toBe("upload");
  });
});

describe("clarificationCount", () => {
  it("counts only the items waiting on somebody outside this company", () => {
    expect(
      clarificationCount([
        { state: "needs_clarification" as RequirementState },
        { state: "blocked" as RequirementState },
        { state: "needs_clarification" as RequirementState },
        { state: "done" as RequirementState },
      ])
    ).toBe(2);
  });
});

describe("requirementDueState", () => {
  const now = new Date("2026-03-10T12:00:00Z");

  it("says nothing at all when there is no date", () => {
    // Not "on track". A requirement with no date of its own is a requirement
    // nobody has dated, and rendering that as reassurance is the exact thing
    // the brief forbids.
    expect(requirementDueState(null, now)).toBeNull();
  });

  it("reports a date already past", () => {
    expect(requirementDueState(new Date("2026-03-09T12:00:00Z"), now)).toBe("overdue");
  });

  it("reports a date inside two days", () => {
    expect(requirementDueState(new Date("2026-03-11T12:00:00Z"), now)).toBe("due_soon");
  });

  it("reports a date further out as later, not as fine", () => {
    expect(requirementDueState(new Date("2026-03-20T12:00:00Z"), now)).toBe("later");
  });
});
