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
] as const;

export type ManualMoveTarget = (typeof MANUAL_MOVE_TARGETS)[number];

export interface ManualMove {
  ok: boolean;
  /** The stage actually written (call stage redirects when calls are off). */
  stage?: string;
  /** Plain-language refusal for the toast. */
  error?: string;
}

/**
 * The transitions a person may make from the pipeline board.
 *
 * This is intentionally a graph, not a list of destinations. A destination
 * only tells us that a stage exists; it says nothing about whether reaching it
 * from the current record would skip evidence or revive closed work. In
 * particular, `submitted` is absent. The only path into that state is the
 * evidence-backed mark-as-sent endpoint.
 */
export const MANUAL_STAGE_TRANSITIONS: Readonly<Record<string, readonly ManualMoveTarget[]>> = {
  monitoring: ["scoring"],
  scoring: ["analysis"],
  analysis: ["scoring", "sub_research"],
  sub_research: ["analysis", "outreach"],
  outreach: ["sub_research", "call_queue", "quote_entry"],
  call_queue: ["outreach", "quote_entry"],
  quote_entry: ["call_queue", "bid_building"],
  bid_building: ["quote_entry"],
};

const CLOSED_STAGES = new Set([
  "submitted",
  "won",
  "lost",
  "dismissed",
  "expired",
  "aborted",
  "canceled",
  "archived",
]);

export function resolveManualMove(
  from: string,
  to: string,
  callsEnabled: boolean
): ManualMove {
  if (CLOSED_STAGES.has(from)) {
    return {
      ok: false,
      error:
        from === "submitted"
          ? "A submitted bid cannot be moved backward. Record the agency outcome, or start a controlled revision from the submission panel."
          : "Closed opportunities cannot be moved back into the active pipeline.",
    };
  }
  if (!(MANUAL_MOVE_TARGETS as readonly string[]).includes(to)) {
    return {
      ok: false,
      error:
        to === "monitoring"
          ? "Monitoring is fed by the scanner; use Scoring to re-enter the pipeline."
          : to === "submitted"
            ? "A stage move cannot claim a bid was submitted. Approve the package, send it, and record the delivery evidence."
          : "Won, lost, and dismissed have their own actions on the card menu.",
    };
  }
  const stage = !callsEnabled && to === CALL_STAGE ? STAGE_AFTER_CALLS : to;
  if (stage === from) {
    return { ok: false, error: "Already in that stage." };
  }
  const allowed = MANUAL_STAGE_TRANSITIONS[from] ?? [];
  if (!allowed.includes(stage as ManualMoveTarget)) {
    return {
      ok: false,
      error: `Move this opportunity one workflow step at a time. From ${from.replace(/_/g, " ")}, the available next or previous step is ${allowed
        .map((s) => s.replace(/_/g, " "))
        .join(" or ") || "none"}.`,
    };
  }
  return { ok: true, stage };
}
