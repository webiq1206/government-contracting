import { describe, it, expect } from "vitest";
import { troubleHasStopped, troubleSummary, agoInWords, type ServiceTrouble } from "../lib/integration-health";
import { evaluatePulse } from "../lib/domain/pipeline-pulse";
const NOW = new Date("2026-10-03T18:00:00Z");
const ago = (mins: number) => new Date(+NOW - mins * 60_000);
const trouble = (over: Partial<ServiceTrouble> = {}): ServiceTrouble => ({ count: 1, reason: "Insufficient credit.", lastAt: ago(120), ...over });
describe("provider recovery evidence", () => {
  it.each([2, 30, 31, 360, 60 * 24 * 40])("does not infer recovery from %i minutes of silence", mins => {
    expect(troubleHasStopped(trouble({ lastAt: ago(mins) }), NOW)).toBe(false);
    expect(troubleSummary(trouble({ lastAt: ago(mins) }), NOW)).toContain("No newer successful request");
  });
  it("requires strictly newer success", () => {
    expect(troubleHasStopped(trouble({ lastSuccessAt: ago(120) }))).toBe(false);
    expect(troubleHasStopped(trouble({ lastSuccessAt: ago(121) }))).toBe(false);
    expect(troubleHasStopped(trouble({ lastSuccessAt: ago(119) }))).toBe(true);
    expect(troubleSummary(trouble({ lastSuccessAt: ago(119) }))).toBeNull();
  });
  it("does not invent failure or recovery when there is no evidence", () => {
    expect(troubleHasStopped(trouble({ lastAt: null }))).toBe(false);
    expect(troubleSummary({ count: 0, reason: null, lastAt: null })).toBeNull();
  });
  it("renders elapsed time", () => {
    expect(agoInWords(ago(0), NOW)).toBe("less than a minute");
    expect(agoInWords(ago(1), NOW)).toBe("1 minute");
    expect(agoInWords(ago(45), NOW)).toBe("45 minutes");
    expect(agoInWords(ago(60), NOW)).toBe("1 hour");
  });
  it("keeps the pulse unresolved after a quiet period without inventing a rolling job count", () => {
    const base = { now: NOW, monitorCadence: "every 3h", workerLastRunAt: ago(4), workerHeartbeatAt: ago(1), workerPhase: "idle", workerBootedAt: ago(600), openCount: 12, samKeyPresent: true, monitorLastOkAt: ago(30), samErrorMessage: null, samQuota: { used: 10, cap: 1000 }, claudeConfigured: true, activeOrgCount: 1 };
    const finding = evaluatePulse({ ...base, claudeFailures: trouble() }).find(x => x.key === "claude_failing");
    expect(finding?.severity).toBe("down");
    expect(finding?.title).toContain("recovery has not been confirmed");
    expect(finding?.detail).toContain("spending controls allow");
    expect(finding?.detail).toContain("picked back up automatically");
    expect(finding?.detail).not.toContain("six hours");
  });
});
