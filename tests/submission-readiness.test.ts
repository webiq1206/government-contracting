import { describe, expect, it } from "vitest";
import { assessReadiness, type ReadinessInput } from "../lib/domain/submission-readiness";

/**
 * Five things get called "ready", and they are not the same thing.
 *
 * `package_ready` covers the mechanical checks: every mandatory requirement
 * has a file against it and validation found no blockers. That is real and
 * useful, and the screen printed it as "Ready to submit, all 14 required items
 * are in place."
 *
 * What that sentence does not say is whether anything read the solicitation
 * back against the package. The compliance audit is a separate pass and it can
 * be skipped, and when it is, the mechanical checks still pass and the
 * headline still says Ready. The audit notice sat further down the page saying
 * the audit had never run.
 *
 * Two true statements, one of which is the one people read.
 */

const input = (over: Partial<ReadinessInput> = {}): ReadinessInput => ({
  mechanicallyComplete: true,
  blockerCount: 0,
  auditStatus: "ok",
  openAuditBlockers: 0,
  verifiedBy: null,
  submissionState: "package_ready",
  humanGateRequired: false,
  ...over,
});

describe("the headline above the send button", () => {
  it("says Ready to send only when everything passed", () => {
    expect(assessReadiness(input()).headline).toBe("Ready to send");
    expect(assessReadiness(input()).maySend).toBe(true);
  });

  it("never says an unqualified Ready when the audit could not run", () => {
    /*
     * The whole reason this module exists. The mechanical checks passed, which
     * is true; nothing read the solicitation back, which is also true; and the
     * screen used to print only the first.
     */
    for (const status of ["skipped", null, undefined, "failed"]) {
      const r = assessReadiness(input({ auditStatus: status }));
      expect(r.headline, String(status)).toBe(
        "Mechanical checks passed, compliance audit unavailable"
      );
    }
  });

  it("says so plainly when the audit found problems", () => {
    const r = assessReadiness(input({ openAuditBlockers: 3 }));
    expect(r.headline).toBe("Mechanical checks passed, compliance audit found problems");
    expect(r.maySend).toBe(false);
  });

  it("says the audit is still running rather than guessing either way", () => {
    const r = assessReadiness(input({ auditStatus: "pending" }));
    expect(r.headline).toContain("still running");
    // Not sendable, and not failed either. Pending is its own answer.
    expect(r.maySend).toBe(true);
    expect(r.nextAction).toBe("Wait for the audit to finish.");
  });

  it("is not ready at all while mechanical items are outstanding", () => {
    const r = assessReadiness(input({ mechanicallyComplete: false, blockerCount: 4 }));
    expect(r.headline).toBe("Not ready. Items are still outstanding.");
    expect(r.steps[0].detail).toBe("4 items still outstanding.");
    expect(r.maySend).toBe(false);
  });

  it("counts one outstanding item in the singular", () => {
    const r = assessReadiness(input({ mechanicallyComplete: false, blockerCount: 1 }));
    expect(r.steps[0].detail).toBe("1 item still outstanding.");
  });
});

describe("when a person has to look", () => {
  it("forces the human gate on when the audit could not run, whatever the setting says", () => {
    /*
     * Without this, an account that has turned the human check off gets an
     * unqualified pass on a package nothing audited. The setting is a
     * preference about workload; this is about whether anything checked.
     */
    const r = assessReadiness(input({ auditStatus: "skipped", humanGateRequired: false }));
    expect(r.humanGateRequired).toBe(true);
    expect(r.maySend).toBe(false);
    expect(r.nextAction).toContain("Read the package against the solicitation yourself");
  });

  it("lets a signed-off unaudited package through", () => {
    const r = assessReadiness(
      input({ auditStatus: "skipped", verifiedBy: "info@webiq.co", humanGateRequired: false })
    );
    expect(r.maySend).toBe(true);
    // The headline still refuses to claim the audit happened.
    expect(r.headline).toBe("Mechanical checks passed, compliance audit unavailable");
  });

  it("respects an account that requires a person even when the audit passed", () => {
    const r = assessReadiness(input({ humanGateRequired: true }));
    expect(r.maySend).toBe(false);
    expect(r.headline).toContain("waiting for a person to sign off");
    expect(r.nextAction).toBe("Have somebody sign this off.");
  });

  it("says the check is not required when it genuinely is not", () => {
    const r = assessReadiness(input());
    const verified = r.steps.find((s) => s.step === "human_verified")!;
    expect(verified.state).toBe("unavailable");
    expect(verified.detail).toBe("Not required by this account's settings.");
  });

  it("names who checked it", () => {
    const r = assessReadiness(input({ humanGateRequired: true, verifiedBy: "info@webiq.co" }));
    const verified = r.steps.find((s) => s.step === "human_verified")!;
    expect(verified.detail).toBe("Checked by info@webiq.co.");
    expect(r.maySend).toBe(true);
  });
});

describe("the five steps as separate facts", () => {
  it("reports all five, always", () => {
    const r = assessReadiness(input());
    expect(r.steps.map((s) => s.step)).toEqual([
      "mechanically_complete",
      "audit_complete",
      "human_verified",
      "approved",
      "ready_to_send",
    ]);
  });

  it("keeps a failed audit distinct from an unavailable one", () => {
    // "It looked and found problems" and "nothing looked" are different, and
    // only one of them is fixed by resolving findings.
    const failed = assessReadiness(input({ openAuditBlockers: 2 }));
    const missing = assessReadiness(input({ auditStatus: "skipped" }));
    expect(failed.steps[1].state).toBe("failed");
    expect(missing.steps[1].state).toBe("unavailable");
    expect(failed.nextAction).toContain("Resolve what the audit flagged");
    expect(missing.nextAction).toContain("Read the package against the solicitation");
  });

  it("tracks approval separately from readiness", () => {
    const before = assessReadiness(input());
    const after = assessReadiness(input({ submissionState: "approved" }));
    expect(before.steps.find((s) => s.step === "approved")!.state).toBe("pending");
    expect(after.steps.find((s) => s.step === "approved")!.state).toBe("passed");
    expect(before.nextAction).toBe("Approve the package.");
    expect(after.nextAction).toBeNull();
  });
});
