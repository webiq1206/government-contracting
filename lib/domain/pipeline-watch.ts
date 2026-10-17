/**
 * Operator alert when scoring, band decisions, or quote requests sit still
 * while work is actually eligible.
 *
 * The hours are the same windows the opportunity page already calls "stuck":
 * scoring is 2 hours, and quote requests wait on analysis, which is 6.
 * A band decision is one short call after the score, so it uses the scoring
 * window. An empty eligible set never alerts. An open incident does not
 * alert again.
 */
import { STALL_HOURS } from "./journey";
import { latchAlertDecision } from "./hold-registry";

export const PIPELINE_STALL_HOURS = {
  scoring: STALL_HOURS.scoring ?? 2,
  band: STALL_HOURS.scoring ?? 2,
  rfq: STALL_HOURS.analysis ?? 6,
} as const;

export type PipelineStallKind = keyof typeof PIPELINE_STALL_HOURS;

export interface PipelineStallInput {
  scoringEligible: number;
  bandEligible: number;
  rfqEligible: number;
  scoringIncidentOpen: boolean;
  bandIncidentOpen: boolean;
  rfqIncidentOpen: boolean;
}

export function pipelineStallActions(
  input: PipelineStallInput
): { kind: PipelineStallKind; action: "alert" | "resolve" }[] {
  const decisions: { kind: PipelineStallKind; active: number; open: boolean }[] = [
    { kind: "scoring", active: input.scoringEligible, open: input.scoringIncidentOpen },
    { kind: "band", active: input.bandEligible, open: input.bandIncidentOpen },
    { kind: "rfq", active: input.rfqEligible, open: input.rfqIncidentOpen },
  ];
  const actions: { kind: PipelineStallKind; action: "alert" | "resolve" }[] = [];
  for (const row of decisions) {
    const action = latchAlertDecision(row.active, row.open);
    if (action !== "quiet") actions.push({ kind: row.kind, action });
  }
  return actions;
}

export const PIPELINE_STALL_CAUSE = {
  scoring: "pipeline_scoring_stall",
  band: "pipeline_band_stall",
  rfq: "pipeline_rfq_stall",
} as const;

export function pipelineStallText(kind: PipelineStallKind, count: number): string {
  const hours = PIPELINE_STALL_HOURS[kind];
  if (kind === "scoring") {
    return `${count} open solicitation(s) have been waiting more than ${hours} hours in scoring while their deadline is still outside the lead time. No score has been recorded.`;
  }
  if (kind === "band") {
    return `${count} open solicitation(s) have a score in the 50-69 review band and no pursue-or-pass decision after ${hours} hours.`;
  }
  return `${count} open pursue solicitation(s) have had no sent quote request after ${hours} hours. Analysis or subcontractor research has not reached outreach.`;
}
