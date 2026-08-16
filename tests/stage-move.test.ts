import { describe, it, expect } from "vitest";
import { resolveManualMove, MANUAL_MOVE_TARGETS } from "@/lib/domain/stage-move";

describe("manual stage moves", () => {
  it("allows every pipeline stage between scoring and submitted", () => {
    for (const t of MANUAL_MOVE_TARGETS) {
      expect(resolveManualMove("monitoring", t, true).ok).toBe(true);
    }
  });

  it("refuses monitoring with a reason that names the alternative", () => {
    const r = resolveManualMove("scoring", "monitoring", true);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Scoring/);
  });

  it("refuses terminal stages toward their own flows", () => {
    for (const t of ["won", "lost", "dismissed"]) {
      const r = resolveManualMove("submitted", t, true);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/own actions/);
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
