import type { SubmissionState } from "./submission-state";

/** Stages in which the opportunity is still being assembled. */
export const EDITABLE_OPPORTUNITY_STAGES = [
  "monitoring",
  "scoring",
  "analysis",
  "sub_research",
  "outreach",
  "call_queue",
  "quote_entry",
  "bid_building",
] as const;

/** Stages in which a quote can legitimately arrive or be revised. */
export const QUOTE_EDIT_STAGES = [
  "outreach",
  "call_queue",
  "quote_entry",
  "bid_building",
] as const;

export const FINAL_OPPORTUNITY_STAGES = [
  "won",
  "lost",
  "dismissed",
  "expired",
  "aborted",
  "canceled",
  "archived",
] as const;

export interface OpportunityLifecycleFacts {
  stage: string;
  status: string | null | undefined;
  pursuitState: string | null | undefined;
  /** Null means no bid has been assembled yet. */
  submissionState?: string | null;
}

export type OpportunityMutation = "manual_move" | "rerun" | "quote" | "pricing" | "bid_build";

function inList(value: string, list: readonly string[]): boolean {
  return list.includes(value);
}

/**
 * One fail-closed answer for every mutation that can move or rewrite a bid.
 *
 * API routes still use a conditional update after this check. This function
 * produces the useful explanation; the conditional update closes the race
 * between reading the state and writing the change.
 */
export function opportunityMutationProblem(
  facts: OpportunityLifecycleFacts,
  mutation: OpportunityMutation
): string | null {
  const stage = String(facts.stage ?? "");
  const status = String(facts.status ?? "");
  const pursuit = String(facts.pursuitState ?? "active");

  if (status !== "open") {
    return "This opportunity is closed, so its workflow and bid records are read-only.";
  }
  if (pursuit !== "active") {
    return pursuit === "paused"
      ? "This pursuit is paused. Resume it before changing its workflow or bid."
      : "This pursuit was aborted. Restart and revalidate it before changing its workflow or bid.";
  }
  if (stage === "submitted") {
    return "This bid is already submitted. Record the agency outcome instead of changing the work that was sent.";
  }
  if (inList(stage, FINAL_OPPORTUNITY_STAGES)) {
    return "This opportunity has a final outcome and cannot be returned to the active pipeline.";
  }
  if (!inList(stage, EDITABLE_OPPORTUNITY_STAGES)) {
    return "This opportunity is in an unknown workflow state, so it was not changed.";
  }

  if ((mutation === "quote" || mutation === "pricing") && !inList(stage, QUOTE_EDIT_STAGES)) {
    return "Pricing can change only after subcontractor outreach has started and before the bid is submitted.";
  }

  const submission = facts.submissionState;
  if (
    (mutation === "quote" || mutation === "pricing" || mutation === "bid_build") &&
    submission != null &&
    submission !== "package_ready"
  ) {
    return submission === "approved"
      ? "This package is approved to send. Reopen it as a controlled revision before changing quotes or pricing."
      : "This package has submission history and is locked against quote, pricing, and document changes.";
  }

  return null;
}

const OUTCOME_SOURCE_STATES: readonly SubmissionState[] = [
  "sent",
  "receipt_confirmed",
  "accepted",
  "rejected",
];

/** The prerequisite that makes an agency outcome a fact about a submitted bid. */
export function outcomeProblem(
  facts: OpportunityLifecycleFacts,
  outcome: "won" | "lost" | "no_award"
): string | null {
  if (facts.stage !== "submitted" || facts.status !== "open") {
    return "Record an outcome only after the bid has been sent and while it is awaiting the agency decision.";
  }
  if (!facts.submissionState || !OUTCOME_SOURCE_STATES.includes(facts.submissionState as SubmissionState)) {
    return "This bid has no completed send record. Approve it, send it, and save the delivery evidence before recording an outcome.";
  }
  if (outcome === "won" && facts.submissionState === "rejected") {
    return "A rejected submission cannot be marked won without first recording a corrected submission.";
  }
  return null;
}

export interface OutcomeDetails {
  outcome: "won" | "lost" | "no_award";
  awardAmount?: number | null;
  contractNumber?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  lossReason?: string | null;
}

/** Validate the facts an outcome creates before any terminal state is written. */
export function outcomeDetailsProblem(details: OutcomeDetails): string | null {
  if (details.outcome === "won") {
    if (
      details.awardAmount == null ||
      !Number.isFinite(details.awardAmount) ||
      details.awardAmount <= 0
    ) {
      return "Enter the awarded dollar amount before recording the win.";
    }
    if (details.awardAmount > 100_000_000) {
      return "The award amount is over $100M. Double-check the figure in dollars, not cents.";
    }
    if (!(details.contractNumber ?? "").trim()) {
      return "Enter the agency contract or award number before recording the win.";
    }
    if ((details.contractNumber ?? "").trim().length > 200) {
      return "The contract or award number is too long.";
    }
    if (!validDate(details.startDate)) {
      return "Enter the contract start date before recording the win.";
    }
    if (!validDate(details.endDate)) {
      return "Enter the contract end date before recording the win.";
    }
    if (details.endDate! < details.startDate!) {
      return "The contract end date cannot be before its start date.";
    }
    return null;
  }

  const reason = (details.lossReason ?? "").trim();
  if (reason.length < 10) {
    return details.outcome === "lost"
      ? "Explain why the bid was lost so the team can learn from it."
      : "Explain why no award was made so the record is complete.";
  }
  if (reason.length > 2_000) return "The outcome reason is too long.";
  return null;
}

/** A package may claim delivery only from the locked, approved bid stage. */
export function sendProblem(facts: OpportunityLifecycleFacts): string | null {
  if (facts.status !== "open") {
    return "This opportunity is closed, so it cannot be marked as sent.";
  }
  if ((facts.pursuitState ?? "active") !== "active") {
    return "Resume this pursuit before recording a package delivery.";
  }
  if (facts.stage !== "bid_building") {
    return facts.stage === "submitted"
      ? "This opportunity is already recorded as submitted."
      : "Return to the bid package and finish its review before recording delivery.";
  }
  if (facts.submissionState !== "approved") {
    return facts.submissionState === "package_ready"
      ? "Approve the package first. Nothing should leave here before the checks have passed."
      : `A bid that is ${String(facts.submissionState ?? "unknown").replace(/_/g, " ")} cannot be marked as sent.`;
  }
  return null;
}

function validDate(value: string | null | undefined): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
