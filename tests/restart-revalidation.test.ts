import { describe, expect, it } from "vitest";
import {
  RESTART_MUST_NOT_QUEUE,
  RESTART_REQUEUE_AGENTS,
  restartMayProceed,
} from "../lib/domain/restart-revalidation";
import { RESTART_REVALIDATION } from "../lib/domain/pursuit-state";

describe("restartMayProceed", () => {
  const now = new Date("2026-09-01T18:00:00.000Z");

  it("lets an open, unsubmitted bid with a future deadline restart", () => {
    expect(
      restartMayProceed({
        status: "open",
        stage: "outreach",
        deadline: "2026-09-15T23:59:00.000Z",
        now,
      })
    ).toEqual({ ok: true });
  });

  it("refuses a bid whose deadline has already passed", () => {
    const r = restartMayProceed({
      status: "open",
      stage: "outreach",
      deadline: "2026-08-01T23:59:00.000Z",
      now,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/deadline/i);
  });

  it("lets a submitted bid restart its post-award tracking", () => {
    expect(
      restartMayProceed({
        status: "open",
        stage: "submitted",
        deadline: "2026-08-01T23:59:00.000Z",
        now,
      })
    ).toEqual({ ok: true });
  });

  it("refuses won or lost work", () => {
    expect(restartMayProceed({ status: "closed", stage: "won", now }).ok).toBe(false);
    expect(restartMayProceed({ status: "closed", stage: "lost", now }).ok).toBe(false);
  });
});

describe("what a restart is allowed to queue", () => {
  it("rechecks the notice and does not send outreach", () => {
    expect(RESTART_REQUEUE_AGENTS).toContain("scoring-engine");
    expect(RESTART_REQUEUE_AGENTS).toContain("solicitation-analyst");
    expect(RESTART_REQUEUE_AGENTS).not.toContain("outreach");
    expect([...RESTART_MUST_NOT_QUEUE]).toEqual(
      expect.arrayContaining(["outreach", "call-prep", "outreach-followup"])
    );
    expect(RESTART_REVALIDATION.join(" ")).toMatch(/none is sent without approval/i);
  });
});
