/**
 * The state the sidebar is allowed to show.
 *
 * The failure this module exists to prevent is specific and was live: a
 * heartbeat-driven sidebar printed "Running normally" while every agent run
 * was failing on an exhausted Anthropic credit balance. Nothing in the
 * arithmetic was wrong. The bug was that liveness was being reported as if it
 * answered a question about outcomes.
 *
 * So the tests that matter most here are not the happy path. They are the ones
 * that assert the words "Running normally" cannot appear while work is
 * stopped, and that a deliberate pause is never dressed up as a fault.
 */
import { describe, it, expect } from "vitest";
import {
  assessAutomation,
  classifyFailure,
  causeSpec,
  type RunFact,
} from "@/lib/domain/automation-health";

const NOW = new Date("2026-08-25T18:00:00Z");
const RECENT = new Date(NOW.getTime() - 60_000).toISOString();

function run(over: Partial<RunFact> = {}): RunFact {
  return { agent: "scoring-engine", label: "Scoring Engine", status: "ok", startedAt: RECENT, ...over };
}

const BEATING = { paused: false, heartbeatAt: RECENT, phase: "ready", now: NOW };

describe("classifyFailure", () => {
  it("reads an exhausted credit balance as a credit problem", () => {
    expect(
      classifyFailure("The Anthropic account cannot pay for requests (its credit balance is too low).")
    ).toBe("provider_credit");
  });

  it("reads a rejected key as an auth problem, not a credit one", () => {
    // Both send the owner to console.anthropic.com, but to different pages and
    // for different money. Confusing them wastes a support round trip.
    expect(classifyFailure("Anthropic rejected the API key. It was revoked.")).toBe("provider_auth");
  });

  it("separates rate limiting from being down", () => {
    expect(classifyFailure("429 too many requests")).toBe("provider_rate_limit");
    expect(classifyFailure("Anthropic returned a server error (HTTP 529)")).toBe("provider_unavailable");
  });

  it("reads a mailbox needing reconnection as an integration problem", () => {
    expect(classifyFailure("invalid_grant: token expired, reconnect gmail")).toBe("integration_auth");
  });

  it("does not guess when there is nothing to read", () => {
    expect(classifyFailure(null)).toBe("unknown");
    expect(classifyFailure("   ")).toBe("unknown");
  });

  it("marks the causes that stop work as blocking and the rest as not", () => {
    expect(causeSpec("provider_credit").blocking).toBe(true);
    expect(causeSpec("provider_auth").blocking).toBe(true);
    expect(causeSpec("integration_auth").blocking).toBe(true);
    expect(causeSpec("provider_rate_limit").blocking).toBe(false);
    expect(causeSpec("network").blocking).toBe(false);
  });
});

describe("assessAutomation", () => {
  it("is healthy when the worker is beating and nothing failed", () => {
    const h = assessAutomation({ ...BEATING, runs: [run(), run()] });
    expect(h.state).toBe("healthy");
    expect(h.headline).toBe("Running normally");
    expect(h.interrupt).toBe(false);
  });

  it("never says 'Running normally' while a blocking cause is live", () => {
    /*
     * The exact contradiction this module was written for. The worker is
     * beating perfectly -- it is picking jobs up promptly and failing them
     * promptly -- and the old sidebar called that healthy.
     */
    const h = assessAutomation({
      ...BEATING,
      runs: [
        run({ status: "error", error: "credit balance is too low" }),
        run({ status: "error", error: "credit balance is too low", agent: "outreach", label: "Outreach" }),
      ],
    });
    expect(h.state).toBe("blocked");
    expect(h.headline).not.toContain("Running normally");
    expect(h.detail).toContain("out of credit");
    expect(h.interrupt).toBe(true);
  });

  it("groups repeated failures with one cause into a single incident", () => {
    const runs = Array.from({ length: 40 }, (_, i) =>
      run({ status: "error", error: "credit balance is too low", agent: `agent-${i % 5}`, label: `Agent ${i % 5}` })
    );
    const h = assessAutomation({ ...BEATING, runs });
    expect(h.incidents).toHaveLength(1);
    expect(h.incidents[0].failures).toBe(40);
    expect(h.incidents[0].affectedWorkflows).toHaveLength(5);
  });

  it("puts a blocking incident above a more frequent non-blocking one", () => {
    // Fifty timeouts that retried are less important than one exhausted
    // balance that did not, however loud the log looks.
    const runs = [
      ...Array.from({ length: 50 }, () => run({ status: "error", error: "fetch failed: ETIMEDOUT" })),
      run({ status: "error", error: "credit balance is too low" }),
    ];
    const h = assessAutomation({ ...BEATING, runs });
    expect(h.incidents[0].cause).toBe("provider_credit");
    expect(h.state).toBe("blocked");
  });

  it("is degraded, not blocked, when failures are retryable", () => {
    const h = assessAutomation({
      ...BEATING,
      runs: [run(), run({ status: "error", error: "429 too many requests" })],
    });
    expect(h.state).toBe("degraded");
    expect(h.interrupt).toBe(false);
  });

  it("treats a deliberate pause as a pause, not a fault", () => {
    /*
     * Pausing stops the jobs, which produces failures, which would otherwise
     * be reported as an incident caused by the very act of pausing. Someone
     * who turned it off knows why it is off.
     */
    const h = assessAutomation({
      ...BEATING,
      paused: true,
      runs: [run({ status: "error", error: "credit balance is too low" })],
    });
    expect(h.state).toBe("paused");
    expect(h.interrupt).toBe(false);
  });

  it("treats an unconfigured account as setup, not failure", () => {
    const h = assessAutomation({ ...BEATING, configured: false, runs: [] });
    expect(h.state).toBe("not_configured");
    expect(h.headline).toContain("not set up");
  });

  it("is blocked when the worker has gone quiet, even with no failures", () => {
    // No failures is exactly what "nothing is running at all" looks like from
    // the job log, which is why the log alone was never enough.
    const h = assessAutomation({
      paused: false,
      heartbeatAt: new Date(NOW.getTime() - 20 * 60_000).toISOString(),
      phase: "ready",
      runs: [],
      now: NOW,
    });
    expect(h.state).toBe("blocked");
    expect(h.detail).toContain("has not checked in");
  });

  it("reports an unreachable queue without needing a failed run to prove it", () => {
    const h = assessAutomation({ ...BEATING, phase: "queue-unreachable", runs: [] });
    expect(h.state).toBe("blocked");
    expect(h.incidents.some((i) => i.cause === "queue_unreachable")).toBe(true);
  });

  it("does not call a quiet new account broken", () => {
    const h = assessAutomation({ ...BEATING, runs: [] });
    expect(h.state).toBe("healthy");
    expect(h.detail).toContain("Nothing has been due to run yet");
  });

  it("flags a deep backlog even when nothing has failed", () => {
    const h = assessAutomation({ ...BEATING, runs: [run()], backlog: 120 });
    expect(h.state).toBe("degraded");
    expect(h.detail).toContain("120 jobs");
  });

  it("reports the last success so 'blocked' can say since when", () => {
    const older = new Date(NOW.getTime() - 3 * 3_600_000).toISOString();
    const h = assessAutomation({
      ...BEATING,
      runs: [
        run({ startedAt: older }),
        run({ status: "error", error: "credit balance is too low" }),
      ],
    });
    expect(h.lastSuccessAt).toBe(older);
  });

  it("does not compute a failure rate from too few runs", () => {
    // One failure out of two is not a 50% failure rate worth reporting, it is
    // two data points. It is also not a 0% failure rate: that would be a claim
    // of a clean record made about a sample too small to support one.
    const h = assessAutomation({ ...BEATING, runs: [run(), run({ status: "error", error: "boom" })] });
    expect(h.failureRate).toBeNull();
    expect(h.runs24h).toBe(2);
  });

  it("has no failure rate at all when nothing ran", () => {
    // The dangerous case. A stopped account reported 0% and read as flawless.
    const h = assessAutomation({ ...BEATING, runs: [] });
    expect(h.failureRate).toBeNull();
    expect(h.runs24h).toBe(0);
  });

  it("computes a rate once there is enough to compute one from", () => {
    const h = assessAutomation({
      ...BEATING,
      runs: [
        run(),
        run(),
        run({ status: "error", error: "boom" }),
        run({ status: "error", error: "boom" }),
      ],
    });
    expect(h.failureRate).toBe(0.5);
    expect(h.runs24h).toBe(4);
    expect(h.errors24h).toBe(2);
  });

  it("does not call a failing window healthy because the newest sample is clean", () => {
    /*
     * Production printed "Running normally" while Solicitation Analyst was
     * failing: the sidebar sampled the newest 500 rows, all scoring successes,
     * and never saw the seven failures sitting further back.
     */
    const h = assessAutomation({
      ...BEATING,
      runs: [run(), run()],
      windowRuns: 1270,
      windowErrors: 7,
    });
    expect(h.state).toBe("degraded");
    expect(h.headline).not.toContain("Running normally");
    expect(h.errors24h).toBe(7);
    expect(h.runs24h).toBe(1270);
    expect(h.failureRate).toBeCloseTo(7 / 1270);
  });
});
