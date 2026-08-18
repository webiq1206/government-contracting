import { describe, it, expect } from "vitest";
import { evaluatePulse, type PulseInput } from "@/lib/domain/pipeline-pulse";

const NOW = new Date("2026-08-18T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function input(over: Partial<PulseInput> = {}): PulseInput {
  // A healthy machine: worker ran minutes ago, monitor completed recently,
  // SAM key present, inbox connected, nothing stuck.
  return {
    now: NOW,
    workerLastRunAt: hoursAgo(0.2),
    openCount: 12,
    samKeyPresent: true,
    monitorLastOkAt: hoursAgo(2),
    samErrorMessage: null,
    samQuota: { used: 120, cap: 900 },
    gmail: { connected: true, status: "ok", lastError: null },
    outreach: { sendFailed: 0, drafts: 0 },
    ...over,
  };
}

describe("a healthy pipeline", () => {
  it("reports nothing", () => {
    expect(evaluatePulse(input())).toEqual([]);
  });
});

describe("the movement leg", () => {
  it("calls out a worker that has gone silent", () => {
    const f = evaluatePulse(input({ workerLastRunAt: hoursAgo(5) }));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ key: "worker_down", severity: "down" });
    expect(f[0].detail).toContain("Reserved VM");
  });

  it("calls out a worker that never ran while work is waiting", () => {
    const f = evaluatePulse(input({ workerLastRunAt: null, openCount: 3 }));
    expect(f[0]).toMatchObject({ key: "worker_down" });
  });

  it("stays quiet on a brand new install with nothing to move", () => {
    expect(
      evaluatePulse(
        input({
          workerLastRunAt: null,
          openCount: 0,
          monitorLastOkAt: null,
          samKeyPresent: false,
          gmail: { connected: false, status: "none", lastError: null },
        })
      )
    ).toEqual([]);
  });

  it("suppresses downstream findings when the worker is the cause", () => {
    // One alarm is a diagnosis; four alarms with one cause is noise.
    const f = evaluatePulse(
      input({
        workerLastRunAt: hoursAgo(9),
        samErrorMessage: "SAM.gov rejected the API key",
        outreach: { sendFailed: 4, drafts: 0 },
      })
    );
    expect(f).toHaveLength(1);
    expect(f[0].key).toBe("worker_down");
  });
});

describe("the discovery leg", () => {
  it("surfaces SAM request failures as deals not coming in", () => {
    const f = evaluatePulse(input({ samErrorMessage: "SAM.gov rejected the API key (HTTP 401)" }));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ key: "sam_failing", severity: "down" });
    expect(f[0].detail).toContain("401");
  });

  it("warns when the monitor has not completed in two cycles", () => {
    const f = evaluatePulse(input({ monitorLastOkAt: hoursAgo(9) }));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ key: "monitor_stalled", severity: "warn" });
  });

  it("warns when the monitor has never completed", () => {
    const f = evaluatePulse(input({ monitorLastOkAt: null }));
    expect(f[0]).toMatchObject({ key: "monitor_stalled" });
  });

  it("says nothing about discovery before a key is connected", () => {
    // The setup checklist owns "connect SAM"; duplicating it here would nag.
    expect(
      evaluatePulse(input({ samKeyPresent: false, monitorLastOkAt: null }))
    ).toEqual([]);
  });

  it("warns when today's call budget is spent", () => {
    const f = evaluatePulse(input({ samQuota: { used: 900, cap: 900 } }));
    expect(f[0]).toMatchObject({ key: "sam_quota", severity: "warn" });
  });
});

describe("the outreach leg", () => {
  it("treats a revoked Google grant as a dead inbox", () => {
    const f = evaluatePulse(
      input({
        gmail: { connected: false, status: "revoked", lastError: "invalid_grant" },
      })
    );
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ key: "gmail_broken", severity: "down" });
    expect(f[0].cta).toContain("Reconnect");
  });

  it("counts failed sends as an outage, not a footnote", () => {
    const f = evaluatePulse(input({ outreach: { sendFailed: 3, drafts: 0 } }));
    expect(f[0]).toMatchObject({ key: "outreach_failing", severity: "down" });
    expect(f[0].title).toContain("3");
  });

  it("points drafts at the missing inbox connection", () => {
    const f = evaluatePulse(
      input({
        gmail: { connected: false, status: "none", lastError: null },
        outreach: { sendFailed: 0, drafts: 5 },
      })
    );
    expect(f[0]).toMatchObject({ key: "outreach_drafts", severity: "warn" });
  });

  it("does not nag about drafts when the inbox is connected (recovery will send them)", () => {
    const f = evaluatePulse(input({ outreach: { sendFailed: 0, drafts: 5 } }));
    expect(f).toEqual([]);
  });

  it("reports a broken inbox and failed sends together", () => {
    const f = evaluatePulse(
      input({
        gmail: { connected: false, status: "revoked", lastError: null },
        outreach: { sendFailed: 2, drafts: 1 },
      })
    );
    expect(f.map((x) => x.key)).toEqual(["gmail_broken", "outreach_failing"]);
  });
});
