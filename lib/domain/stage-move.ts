/**
 * What it means to move an opportunity to a stage by hand.
 *
 * Drag-and-drop on the board and "Move to" in the card menu both land here.
 * A manual move is an operator overriding the pipeline's own routing, so the
 * rules are about where that override is safe: never into monitoring (a
 * cron-fed holding pen nothing routes out of by hand), never into the
 * terminal stages that have their own flows with their own consequences
 * (dismiss archives, won/lost record outcomes), and never into the call
 * stage when calling is switched off, which silently redirects to the stage
 * that replaced it rather than erroring, because the operator's intent
 * ("push this toward quotes") is clear.
 */
import { CALL_STAGE, STAGE_AFTER_CALLS } from "./call-step";

/** Stages an operator may drop an opportunity into. */
export const MANUAL_MOVE_TARGETS = [
  "scoring",
  "analysis",
  "sub_research",
  "outreach",
  "call_queue",
  "quote_entry",
  "bid_building",
  "submitted",
] as const;

export type ManualMoveTarget = (typeof MANUAL_MOVE_TARGETS)[number];

export interface ManualMove {
  ok: boolean;
  /** The stage actually written (call stage redirects when calls are off). */
  stage?: string;
  /** Plain-language refusal for the toast. */
  error?: string;
}

export function resolveManualMove(
  from: string,
  to: string,
  callsEnabled: boolean
): ManualMove {
  if (!(MANUAL_MOVE_TARGETS as readonly string[]).includes(to)) {
    return {
      ok: false,
      error:
        to === "monitoring"
          ? "Monitoring is fed by the scanner; use Scoring to re-enter the pipeline."
          : "Won, lost, and dismissed have their own actions on the card menu.",
    };
  }
  const stage = !callsEnabled && to === CALL_STAGE ? STAGE_AFTER_CALLS : to;
  if (stage === from) {
    return { ok: false, error: "Already in that stage." };
  }
  return { ok: true, stage };
}
