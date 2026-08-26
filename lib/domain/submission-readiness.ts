/**
 * Five things that all get called "ready", and are not the same thing.
 *
 * `package_ready` is one boolean covering the mechanical checks: every
 * mandatory requirement has a file against it and validation found no
 * blockers. It is a real and useful fact, and the screen printed it as "Ready
 * to submit, all 14 required items are in place."
 *
 * What that sentence does not say is whether anything read the solicitation
 * back against the package. The compliance audit is a separate pass, it can be
 * skipped (no AI key, unreadable solicitation text, an outage), and when it is
 * skipped the mechanical checks still pass and the headline still says Ready.
 * The audit notice sat further down the page saying the audit had never run.
 *
 * Two true statements, one of which is the one people read.
 *
 * So readiness is five separate facts, each named, and the headline is
 * assembled from what is actually true rather than from the strongest of them.
 *
 * Distinct from `bid-readiness.ts`, which answers a different question: that
 * one is about progress through the workflow and what still needs attention.
 * This one is about how much assurance stands behind the package right now,
 * which is what the headline above the send button is claiming.
 *
 * Pure.
 */

export const READINESS_STEPS = [
  "mechanically_complete",
  "audit_complete",
  "human_verified",
  "approved",
  "ready_to_send",
] as const;
export type ReadinessStep = (typeof READINESS_STEPS)[number];

export const READINESS_LABEL: Record<ReadinessStep, string> = {
  mechanically_complete: "Mechanical checks passed",
  audit_complete: "Compliance audit passed",
  human_verified: "Checked by a person",
  approved: "Approved",
  ready_to_send: "Ready to send",
};

export type StepState = "passed" | "failed" | "unavailable" | "pending";

export interface ReadinessInput {
  /** Every mandatory requirement has something against it and validation is clean. */
  mechanicallyComplete: boolean;
  /** How many mechanical blockers are outstanding, for the wording. */
  blockerCount: number;
  /** ok | pending | skipped | failed | null when it has never been asked for. */
  auditStatus: string | null | undefined;
  /** Audit findings that block, after filtering to the ones still open. */
  openAuditBlockers: number;
  /** Somebody signed off, and who. */
  verifiedBy: string | null;
  /** The bid's submission state, from the submission model. */
  submissionState: string;
  /**
   * Does this account require a person to check before sending?
   *
   * Configured, because a one-person shop and a firm with a contracts manager
   * genuinely differ. But it is FORCED on when the audit could not run: the
   * instruction is explicit, and the reason is that an unaudited package with
   * nobody checking is a package assembled against a checklist nothing read.
   */
  humanGateRequired: boolean;
}

export interface ReadinessStepResult {
  step: ReadinessStep;
  state: StepState;
  /** What this step actually says, in a sentence. */
  detail: string;
}

export interface Readiness {
  steps: ReadinessStepResult[];
  /** The one line at the top. Never stronger than the weakest step allows. */
  headline: string;
  /** True only when everything required has genuinely passed. */
  maySend: boolean;
  /** True when a person must look before this can go, whatever the settings say. */
  humanGateRequired: boolean;
  /** What to do next, or null when the answer is "send it". */
  nextAction: string | null;
}

function auditState(status: string | null | undefined, openBlockers: number): StepState {
  if (status === "ok") return openBlockers > 0 ? "failed" : "passed";
  if (status === "pending") return "pending";
  // Skipped, failed, or never asked for. All three mean the same thing to
  // somebody deciding whether to send: nothing read the solicitation back.
  return "unavailable";
}

export function assessReadiness(input: ReadinessInput): Readiness {
  const mechanical: ReadinessStepResult = {
    step: "mechanically_complete",
    state: input.mechanicallyComplete ? "passed" : "failed",
    detail: input.mechanicallyComplete
      ? "Every mandatory item has a file against it and validation found nothing outstanding."
      : `${input.blockerCount} item${input.blockerCount === 1 ? "" : "s"} still outstanding.`,
  };

  const audit = auditState(input.auditStatus, input.openAuditBlockers);
  const auditStep: ReadinessStepResult = {
    step: "audit_complete",
    state: audit,
    detail:
      audit === "passed"
        ? "The solicitation was read back against this package and nothing was flagged."
        : audit === "failed"
          ? `The audit flagged ${input.openAuditBlockers} thing${input.openAuditBlockers === 1 ? "" : "s"} that still need resolving.`
          : audit === "pending"
            ? "The audit is running."
            : "The compliance audit could not run, so nothing has read the solicitation back against this package.",
  };

  /*
   * A skipped audit forces the human gate on, whatever the account's setting
   * says. This is the whole point: without it, an account that has turned off
   * the human check gets an unqualified Ready on a package nothing audited.
   */
  const humanGateRequired = input.humanGateRequired || audit === "unavailable" || audit === "failed";

  const verified: ReadinessStepResult = {
    step: "human_verified",
    state: input.verifiedBy ? "passed" : humanGateRequired ? "pending" : "unavailable",
    detail: input.verifiedBy
      ? `Checked by ${input.verifiedBy}.`
      : humanGateRequired
        ? audit === "unavailable"
          ? "Somebody has to read this against the solicitation, because the audit could not."
          : "Somebody has to sign this off before it goes."
        : "Not required by this account's settings.",
  };

  const approvedNow = input.submissionState !== "package_ready";
  const approved: ReadinessStepResult = {
    step: "approved",
    state: approvedNow ? "passed" : "pending",
    detail: approvedNow ? "Cleared to send." : "Not approved yet.",
  };

  const maySend =
    mechanical.state === "passed" &&
    audit !== "failed" &&
    (!humanGateRequired || verified.state === "passed");

  const readyToSend: ReadinessStepResult = {
    step: "ready_to_send",
    state: maySend ? "passed" : "pending",
    detail: maySend
      ? "Everything required has passed."
      : "Not everything required has passed yet.",
  };

  return {
    steps: [mechanical, auditStep, verified, approved, readyToSend],
    headline: headlineFor(mechanical, audit, verified, humanGateRequired),
    maySend,
    humanGateRequired,
    nextAction: nextActionFor(mechanical, audit, verified, approved, maySend),
  };
}

/**
 * The one line at the top, and the reason this module exists.
 *
 * It is never stronger than the weakest step allows. "Ready to submit" unqualified
 * is reserved for a package that passed the mechanical checks AND was audited,
 * because those are two different assurances and the second is the one that
 * catches a package assembled correctly against the wrong requirements.
 */
function headlineFor(
  mechanical: ReadinessStepResult,
  audit: StepState,
  verified: ReadinessStepResult,
  humanGateRequired: boolean
): string {
  if (mechanical.state !== "passed") return "Not ready. Items are still outstanding.";
  if (audit === "failed") return "Mechanical checks passed, compliance audit found problems";
  if (audit === "pending") return "Mechanical checks passed, compliance audit still running";
  if (audit === "unavailable") return "Mechanical checks passed, compliance audit unavailable";
  if (humanGateRequired && verified.state !== "passed") {
    return "Mechanical checks and compliance audit passed, waiting for a person to sign off";
  }
  return "Ready to send";
}

function nextActionFor(
  mechanical: ReadinessStepResult,
  audit: StepState,
  verified: ReadinessStepResult,
  approved: ReadinessStepResult,
  maySend: boolean
): string | null {
  if (mechanical.state !== "passed") return "Clear the outstanding items above.";
  if (audit === "failed") return "Resolve what the audit flagged, or record why it does not apply.";
  if (audit === "pending") return "Wait for the audit to finish.";
  if (verified.state === "pending") {
    return audit === "unavailable"
      ? "Read the package against the solicitation yourself, then mark it checked."
      : "Have somebody sign this off.";
  }
  if (approved.state !== "passed") return "Approve the package.";
  return maySend ? null : "Something above is still outstanding.";
}
