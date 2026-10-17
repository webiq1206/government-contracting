/**
 * One alert when pursue work is waiting and the job that would move it has
 * not run. A later tick does not send the alert again. The alert ends when
 * the waiting work is gone.
 *
 * Band and sourcing use two hours, matching the scoring stall. Quote
 * requests use six hours, because a verified email can wait on the daily cap
 * without the pipeline being stopped.
 */

export const BAND_STALL_HOURS = 2;
export const SOURCING_STALL_HOURS = 2;
export const RFQ_STALL_HOURS = 6;
export const PIPELINE_STALL_CAUSE = "pursuit_pipeline_stall";

export interface PipelineStallCounts {
  undecidedBand: number;
  bandDecisions: number;
  unsourcedPursue: number;
  finderRuns: number;
  unverifiedPairings: number;
  verifyRuns: number;
  unsentVerified: number;
  outreachRuns: number;
  outboundPaused: boolean;
}

export function pipelineStallEligible(input: PipelineStallCounts): boolean {
  if (input.undecidedBand > 0 && input.bandDecisions === 0) return true;
  if (input.unsourcedPursue > 0 && input.finderRuns === 0) return true;
  if (input.unverifiedPairings > 0 && input.verifyRuns === 0) return true;
  if (!input.outboundPaused && input.unsentVerified > 0 && input.outreachRuns === 0) return true;
  return false;
}

export function pipelineStallDecision(input: {
  eligible: boolean;
  incidentOpen: boolean;
}): "alert" | "resolve" | "quiet" {
  if (input.eligible) return "alert";
  if (input.incidentOpen) return "resolve";
  return "quiet";
}

export function pipelineStallText(input: PipelineStallCounts): string {
  const parts: string[] = [];
  if (input.undecidedBand > 0 && input.bandDecisions === 0) {
    parts.push(
      `${input.undecidedBand} finished score(s) in the 50-69 band have no pursue-or-pass decision, and none was recorded in the last ${BAND_STALL_HOURS} hours.`
    );
  }
  if (input.unsourcedPursue > 0 && input.finderRuns === 0) {
    parts.push(
      `${input.unsourcedPursue} pursue item(s) have a brief and no subcontractor pairing, and sub-finder has not run in the last ${SOURCING_STALL_HOURS} hours.`
    );
  }
  if (input.unverifiedPairings > 0 && input.verifyRuns === 0) {
    parts.push(
      `${input.unverifiedPairings} active pairing(s) are unverified, and sub-verify has not run in the last ${SOURCING_STALL_HOURS} hours.`
    );
  }
  if (!input.outboundPaused && input.unsentVerified > 0 && input.outreachRuns === 0) {
    parts.push(
      `${input.unsentVerified} verified email(s) have not been sent a quote request, and outreach has not run in the last ${RFQ_STALL_HOURS} hours.`
    );
  }
  return parts.join(" ");
}
