/**
 * A failure count is history, not a diagnosis.
 *
 * `recentAiTrouble` counts rows written in the last six hours. Topping up an
 * empty Anthropic balance fixes the cause and deletes none of those rows, so
 * for six hours afterwards the count stays high while nothing is wrong. The
 * product reported that count in the present tense: "The AI is refusing every
 * request", "FAIL ... The AI is refusing requests". An owner who had just paid
 * read it as the top-up having failed and went looking for a second cause.
 *
 * These tests pin the distinction, because it is invisible in a number and the
 * wrong reading is the natural one.
 */
import { describe, it, expect } from "vitest";
import {
  troubleHasStopped,
  troubleSummary,
  agoInWords,
  type ServiceTrouble,
} from "../lib/integration-health";
import { evaluatePulse } from "../lib/domain/pipeline-pulse";

const NOW = new Date("2026-08-26T18:00:00Z");
const ago = (mins: number) => new Date(NOW.getTime() - mins * 60_000);

function trouble(over: Partial<ServiceTrouble> = {}): ServiceTrouble {
  return { count: 490, reason: "Credit balance is too low.", lastAt: ago(120), ...over };
}

describe("troubleHasStopped", () => {
  it("is false while failures are still arriving", () => {
    expect(troubleHasStopped(trouble({ lastAt: ago(2) }), NOW)).toBe(false);
  });

  it("is false at the boundary, so a gap between runs cannot clear the alarm", () => {
    // Exactly 30 minutes is not yet two full 15-minute cycles.
    expect(troubleHasStopped(trouble({ lastAt: ago(30) }), NOW)).toBe(false);
    expect(troubleHasStopped(trouble({ lastAt: ago(31) }), NOW)).toBe(true);
  });

  it("is false when there were no failures at all", () => {
    // Nothing has "stopped" if nothing started. This must not read as recovery.
    expect(troubleHasStopped({ count: 0, reason: null, lastAt: null }, NOW)).toBe(false);
  });

  it("is false when the timestamp is missing, rather than guessing", () => {
    expect(troubleHasStopped(trouble({ lastAt: null }), NOW)).toBe(false);
  });
});

describe("troubleSummary", () => {
  it("says the failures stopped, and that the count clears itself", () => {
    const s = troubleSummary(trouble({ lastAt: ago(120) }), NOW) ?? "";
    expect(s).toContain("490 jobs failed");
    expect(s).toContain("2 hours ago");
    expect(s).toContain("nothing has failed since");
    expect(s).toContain("clears on its own");
    // The whole point: it must not claim a live outage.
    expect(s).not.toContain("is refusing");
  });

  it("names how recent the failures are when they are ongoing", () => {
    const s = troubleSummary(trouble({ lastAt: ago(3) }), NOW) ?? "";
    expect(s).toContain("most recently 3 minutes ago");
    expect(s).not.toContain("clears on its own");
  });

  it("stays null when nothing failed", () => {
    expect(troubleSummary({ count: 0, reason: null, lastAt: null }, NOW)).toBeNull();
  });
});

describe("agoInWords", () => {
  it("reads as a sentence at every scale", () => {
    expect(agoInWords(ago(0), NOW)).toBe("less than a minute");
    expect(agoInWords(ago(1), NOW)).toBe("1 minute");
    expect(agoInWords(ago(45), NOW)).toBe("45 minutes");
    expect(agoInWords(ago(60), NOW)).toBe("1 hour");
    expect(agoInWords(ago(300), NOW)).toBe("5 hours");
  });
});

describe("the pipeline pulse banner", () => {
  const base = {
    now: NOW,
    monitorCadence: "every 3h",
    workerLastRunAt: ago(4),
    workerHeartbeatAt: ago(1),
    workerPhase: "idle",
    workerBootedAt: ago(600),
    openCount: 12,
    samKeyPresent: true,
    monitorLastOkAt: ago(30),
    samErrorMessage: null,
    samQuota: { used: 10, cap: 1000 },
    claudeConfigured: true,
    activeOrgCount: 1,
  };

  it("reports a live outage as down and in the present tense", () => {
    const out = evaluatePulse({
      ...base,
      claudeFailures: { count: 490, reason: "Credit balance is too low.", lastAt: ago(2) },
    });
    const f = out.find((x) => x.key === "claude_failing");
    expect(f?.severity).toBe("down");
    expect(f?.title).toContain("is refusing every request");
  });

  it("downgrades to a warning once failures have stopped", () => {
    const out = evaluatePulse({
      ...base,
      claudeFailures: { count: 490, reason: "Credit balance is too low.", lastAt: ago(120) },
    });
    const f = out.find((x) => x.key === "claude_failing");
    expect(f?.severity).toBe("warn");
    expect(f?.title).toContain("was refusing");
    expect(f?.title).not.toContain("is refusing");
    expect(f?.detail).toContain("looks fixed");
  });

  it("says what happens to the work the outage cost, rather than leaving it unsaid", () => {
    /*
     * The first version of this claimed the failed jobs "were not retried",
     * which is false: scoring-recovery-sweep re-queues unscored opportunities
     * every 15 minutes, and stalled-pipeline-sweep re-runs every other stage
     * once it passes its STALL_HOURS threshold. Telling an owner their
     * backlog needs manual attention when it does not is the same defect as
     * telling them a service is down when it is up, and it costs them an
     * afternoon instead of five minutes.
     *
     * What the banner owes them is that recovery is automatic AND not
     * instant, so a still-thin Review queue an hour later is expected rather
     * than a second fault.
     */
    const out = evaluatePulse({
      ...base,
      claudeFailures: { count: 490, reason: "Credit balance is too low.", lastAt: ago(120) },
    });
    const f = out.find((x) => x.key === "claude_failing");
    expect(f?.detail).toContain("picked back up automatically");
    expect(f?.detail).toContain("15 minutes");
    expect(f?.detail).toContain("over the next few hours");
    expect(f?.detail).not.toContain("not retried");
  });

  it("treats a missing timestamp as ongoing rather than assuming recovery", () => {
    const out = evaluatePulse({
      ...base,
      claudeFailures: { count: 3, reason: null, lastAt: null },
    });
    expect(out.find((x) => x.key === "claude_failing")?.severity).toBe("down");
  });
});
