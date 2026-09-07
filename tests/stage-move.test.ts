import { describe, it, expect } from "vitest";
import {
  resolveManualMove,
  MANUAL_MOVE_TARGETS,
  MANUAL_STAGE_TRANSITIONS,
} from "@/lib/domain/stage-move";

describe("manual stage moves", () => {
  it("allows every declared adjacent edge in the lifecycle graph", () => {
    for (const [from, targets] of Object.entries(MANUAL_STAGE_TRANSITIONS)) {
      for (const to of targets) {
        expect(resolveManualMove(from, to, true), `${from} to ${to}`).toEqual({
          ok: true,
          stage: to,
        });
      }
    }
  });

  it("refuses a move that skips required workflow steps", () => {
    const r = resolveManualMove("monitoring", "bid_building", true);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/one workflow step at a time/i);
  });

  it("refuses monitoring with a reason that names the alternative", () => {
    const r = resolveManualMove("scoring", "monitoring", true);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Scoring/);
  });

  it("never lets a manual move claim submission", () => {
    const r = resolveManualMove("bid_building", "submitted", true);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/delivery evidence/i);
    expect(MANUAL_MOVE_TARGETS).not.toContain("submitted");
  });

  it("refuses backward moves from submitted and final stages", () => {
    for (const from of ["submitted", "won", "lost", "dismissed"]) {
      const r = resolveManualMove(from, "analysis", true);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/submitted|closed/i);
    }
  });

  it("redirects the call stage to quote entry when calling is off", () => {
    const r = resolveManualMove("outreach", "call_queue", false);
    expect(r).toEqual({ ok: true, stage: "quote_entry" });
  });

  it("treats a drop on the current stage as a no-op refusal", () => {
    expect(resolveManualMove("outreach", "outreach", true).ok).toBe(false);
  });

  it("counts the disabled-calls redirect landing on the current stage as a no-op", () => {
    expect(resolveManualMove("quote_entry", "call_queue", false).ok).toBe(false);
  });
});
