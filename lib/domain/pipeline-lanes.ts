/**
 * Who the ball is with, for the simple pipeline view.
 *
 * Pulled out of the page so the rule can be tested directly. It got this wrong
 * in a way nobody could see from the code: the lane was decided by
 * human_action_required before any stage was considered, and that flag is set
 * by a dozen agents to mark one record as worth a look. It accumulates, so on
 * a real pipeline it was true for 127 of 128 opportunities and "Needs you"
 * meant nothing.
 *
 * Stage ownership decides the lane, from the same STAGE_MODE the full board
 * labels its columns with, so the two views cannot disagree again.
 */
import { stageMode } from "../stage-meta";
import { stageParty } from "./journey";

export type LaneKey = "you" | "system" | "waiting" | "decided";

export interface LaneInput {
  stage: string;
  tier?: string | null;
  human_action_required?: boolean | null;
}

export function laneFor(o: LaneInput): LaneKey {
  if (o.stage === "won" || o.stage === "lost") return "decided";
  // The one case where an automatic stage really is waiting on a person: a
  // review-tier score is a decision the operator has to make, and the record
  // sits in `scoring` until they make it. This is the Review queue.
  if (o.tier === "review" && o.human_action_required) return "you";
  if (stageMode(o.stage) === "you") return "you";
  const party = stageParty(o.stage);
  if (party === "subs" || party === "agency") return "waiting";
  return "system";
}
