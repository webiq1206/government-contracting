/**
 * The simple view must agree with the stage board beside it.
 *
 * Both are meant to read STAGE_MODE, which exists so the automatic-versus-
 * needs-you signal is identical site-wide. The lane function was not: it put
 * anything carrying human_action_required into "Needs you" before looking at
 * the stage at all, and that flag is set by a dozen agents to mark one record
 * as worth a look. It accumulates, so a real pipeline showed 127 of 128
 * opportunities needing a person while the board next to it called their
 * stages Automatic.
 */
import { describe, it, expect } from "vitest";
import { laneFor } from "../lib/domain/pipeline-lanes";
import { stageMode } from "../lib/stage-meta";
import { PIPELINE_STAGES } from "../lib/data";

describe("pipeline lanes", () => {
  it("keeps automatic stages out of Needs you even when flagged", () => {
    // The exact case reported: analysis, sub research and outreach filling the
    // Needs you lane. Every one of these is labelled Automatic on the board.
    for (const stage of ["monitoring", "scoring", "analysis", "sub_research"]) {
      expect(laneFor({ stage, human_action_required: true }), stage).toBe("system");
    }
    expect(laneFor({ stage: "outreach", human_action_required: true })).toBe("waiting");
  });

  it("puts the human-owned stages in Needs you, flag or no flag", () => {
    for (const stage of ["call_queue", "quote_entry", "bid_building"]) {
      expect(laneFor({ stage, human_action_required: false }), stage).toBe("you");
      expect(laneFor({ stage, human_action_required: true }), stage).toBe("you");
    }
  });

  it("still surfaces a review-tier decision, which sits in an automatic stage", () => {
    // The Review queue: scored borderline, waiting on a person to decide.
    expect(laneFor({ stage: "scoring", tier: "review", human_action_required: true })).toBe(
      "you"
    );
    // Scored review but already actioned is no longer waiting on anyone.
    expect(laneFor({ stage: "scoring", tier: "review", human_action_required: false })).toBe(
      "system"
    );
  });

  it("separates waiting on others from working", () => {
    expect(laneFor({ stage: "outreach" })).toBe("waiting");
    expect(laneFor({ stage: "submitted" })).toBe("waiting");
    expect(laneFor({ stage: "analysis" })).toBe("system");
  });

  it("files decided work under decided", () => {
    expect(laneFor({ stage: "won", human_action_required: true })).toBe("decided");
    expect(laneFor({ stage: "lost", human_action_required: true })).toBe("decided");
  });

  it("agrees with the stage board on every stage it shows", () => {
    // The guarantee that was missing. A stage the board calls Automatic must
    // never land in Needs you on the strength of a flag, and a stage it calls
    // Needs you must always land there.
    for (const { key } of PIPELINE_STAGES) {
      if (key === "won" || key === "lost") continue;
      const lane = laneFor({ stage: key, human_action_required: true });
      if (stageMode(key) === "you") expect(lane, key).toBe("you");
      else expect(lane, key).not.toBe("you");
    }
  });
});
