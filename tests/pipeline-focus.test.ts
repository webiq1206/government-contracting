import { describe, it, expect } from "vitest";
import {
  FOCUS_KEYS,
  FOCUS_SETS,
  focusCount,
  focusSet,
} from "@/lib/domain/pipeline-focus";
import { PIPELINE_STAGES } from "@/lib/data";

describe("pipeline focus sets", () => {
  it("only names stages the board can actually show", () => {
    const known = new Set(PIPELINE_STAGES.map((s) => s.key));
    for (const key of FOCUS_KEYS) {
      for (const stage of FOCUS_SETS[key].stages) {
        expect(known, `${key} names an unknown stage: ${stage}`).toContain(stage);
      }
    }
  });

  it("counts exactly the stages the board will filter to", () => {
    const byStage = {
      scoring: 5,
      analysis: 10,
      sub_research: 7,
      outreach: 20,
      call_queue: 3,
      quote_entry: 8,
      bid_building: 4,
    };
    // in_capture = analysis + sub_research + outreach + quote_entry + bid_building
    expect(focusCount("in_capture", byStage)).toBe(10 + 7 + 20 + 8 + 4);
    // in_pursuit = outreach + call_queue + quote_entry + bid_building
    expect(focusCount("in_pursuit", byStage)).toBe(20 + 3 + 8 + 4);
    expect(focusCount("packages_ready", byStage)).toBe(4);
  });

  it("treats a missing stage as zero rather than NaN", () => {
    expect(focusCount("in_pursuit", {})).toBe(0);
  });

  it("resolves known keys and refuses anything else", () => {
    expect(focusSet("in_pursuit")?.label).toBe("In pursuit");
    expect(focusSet("nonsense")).toBeNull();
    expect(focusSet(null)).toBeNull();
    expect(focusSet(undefined)).toBeNull();
  });

  it("gives every set a label and an explanation for the filtered board", () => {
    for (const key of FOCUS_KEYS) {
      expect(FOCUS_SETS[key].label.length).toBeGreaterThan(0);
      expect(FOCUS_SETS[key].blurb.length).toBeGreaterThan(0);
      expect(FOCUS_SETS[key].stages.length).toBeGreaterThan(0);
    }
  });
});
