import { describe, expect, it } from "vitest";
import { scoringWatchDecision } from "@/lib/domain/scoring-watchdog";
import { watchScoring, type ScoringWatchDeps } from "@/lib/domain/scoring-watchdog-run";

function deps(over: Partial<ScoringWatchDeps> = {}) {
  const alerts: string[] = [];
  const claimed = new Set<string>();
  const base: ScoringWatchDeps = {
    counts: async () => ({ completedScores: 0, arrived: 3 }),
    incidentOpen: async () => null,
    openIncident: async () => ({ id: "stall-1" }),
    claimAlert: async (_org, id, kind) => {
      const key = `${id}:${kind}`;
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    },
    sendAlert: async (alert) => {
      alerts.push(alert.subject);
    },
    markRecovered: async () => undefined,
    ...over,
  };
  return Object.assign(base, { alerts, claimed });
}

describe("scoring watchdog", () => {
  it("stays quiet when nothing arrived and when scores are already finishing", () => {
    expect(scoringWatchDecision({ completedScores: 0, arrived: 0, incidentOpen: false })).toBe("quiet");
    expect(scoringWatchDecision({ completedScores: 2, arrived: 4, incidentOpen: false })).toBe("quiet");
    expect(scoringWatchDecision({ completedScores: 0, arrived: 1, incidentOpen: false })).toBe("alert");
    expect(scoringWatchDecision({ completedScores: 1, arrived: 1, incidentOpen: true })).toBe("resolve");
  });

  it("sends one start alert and ignores the later ticks", async () => {
    const harness = deps();
    const first = await watchScoring("org", harness);
    const second = await watchScoring("org", harness);
    expect(first).toEqual({ alerted: true, resolved: false });
    expect(second).toEqual({ alerted: false, resolved: false });
    expect(harness.alerts).toEqual(["Scoring has stopped"]);
  });

  it("sends one end alert and closes the stall when a score finishes", async () => {
    const recovered: string[] = [];
    const harness = deps({
      counts: async () => ({ completedScores: 1, arrived: 3 }),
      incidentOpen: async () => ({ id: "stall-1" }),
      markRecovered: async (_org, id) => {
        recovered.push(id);
      },
    });
    const first = await watchScoring("org", harness);
    const second = await watchScoring("org", harness);
    expect(first).toEqual({ alerted: false, resolved: true });
    expect(second.resolved).toBe(true);
    expect(harness.alerts).toEqual(["Scoring resumed"]);
    expect(recovered).toEqual(["stall-1", "stall-1"]);
  });
});
