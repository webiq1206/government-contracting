import { describe, expect, it } from "vitest";
import {
  BULK_KINDS,
  BULK_LABEL,
  BULK_REVERSIBLE,
  BULK_UNDO_LABEL,
  SKIP_REASON_TEXT,
  describeOutcome,
  normalizeTag,
} from "@/lib/domain/sub-bulk";

describe("what a batch says it did", () => {
  it("says nothing changed rather than reporting a zero as a success", () => {
    expect(describeOutcome({ kind: "tag", changed: 0, skipped: [], batchId: null })).toBe(
      "Nothing changed."
    );
  });

  it("counts in the singular when it should", () => {
    expect(describeOutcome({ kind: "tag", changed: 1, skipped: [], batchId: "b" })).toBe(
      "1 firm updated."
    );
    expect(describeOutcome({ kind: "archive", changed: 4, skipped: [], batchId: "b" })).toBe(
      "4 firms updated."
    );
  });

  it("uses queued rather than updated for a re-check, because nothing has changed yet", () => {
    expect(describeOutcome({ kind: "verify", changed: 2, skipped: [], batchId: "b" })).toBe(
      "2 firms queued for a re-check."
    );
  });

  /*
   * The rule this function exists for. "27 were not changed" with no reason
   * is how somebody stops trusting the number, and the reasons here lead to
   * different next actions: a blocked firm is a decision, a merged one is a
   * pointer, and one with no website is a data gap somebody can fill.
   */
  it("never reports a skip without saying why", () => {
    const text = describeOutcome({
      kind: "verify",
      changed: 3,
      skipped: [
        { id: "a", reason: "blocked" },
        { id: "b", reason: "blocked" },
        { id: "c", reason: "nothing_to_check" },
        { id: "d", reason: "merged" },
      ],
      batchId: "b",
    });
    expect(text).toContain("3 firms queued for a re-check.");
    expect(text).toContain("4 left alone");
    expect(text).toContain("2 marked do not use");
    expect(text).toContain("1 no website or email to check");
    expect(text).toContain("1 folded into another record");
  });

  it("names automation being paused rather than counting those rows as queued", () => {
    const text = describeOutcome({
      kind: "verify",
      changed: 0,
      skipped: [{ id: "a", reason: "automation_paused" }],
      batchId: null,
    });
    // enqueue returns null when automation is paused. Reporting those as
    // queued sends somebody looking for results that are not coming.
    expect(text).toContain("automation is paused");
  });
});

describe("tags", () => {
  it("collapses whitespace so one tag does not become two", () => {
    expect(normalizeTag("  preferred   hvac ")).toBe("preferred hvac");
  });

  it("refuses an empty tag and one too long to read", () => {
    expect(normalizeTag("   ")).toBeNull();
    expect(normalizeTag("x".repeat(41))).toBeNull();
    expect(normalizeTag("x".repeat(40))).toBe("x".repeat(40));
  });
});

describe("what can be taken back", () => {
  it("does not offer to undo a re-check, and says nothing where the label would go", () => {
    /*
     * Undoing a verification would restore a stale answer, which is worse
     * than the fresh one whichever way it went.
     */
    expect(BULK_REVERSIBLE.verify).toBe(false);
    expect(BULK_UNDO_LABEL.verify).toBeNull();
  });

  it("has an undo label for every reversible kind, and only those", () => {
    for (const k of BULK_KINDS) {
      expect(BULK_LABEL[k]).toBeTruthy();
      expect(Boolean(BULK_UNDO_LABEL[k])).toBe(BULK_REVERSIBLE[k]);
    }
  });

  it("has wording for every skip reason", () => {
    for (const r of Object.keys(SKIP_REASON_TEXT)) {
      expect(SKIP_REASON_TEXT[r as keyof typeof SKIP_REASON_TEXT]).toBeTruthy();
    }
  });
});
