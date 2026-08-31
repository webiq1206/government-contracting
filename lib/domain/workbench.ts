/**
 * Which workspace a task opens into, and what it is called.
 *
 * The queue carries six kinds, and one of them -- `decide` -- covers two
 * genuinely different situations: a borderline score somebody has to call, and
 * a quote request a subcontractor is still sitting on. They read the same in
 * the list and need opposite screens: one is a decision with a brief, the
 * other is a wait with a nudge. Splitting them is the only real judgment in
 * this file, so it is here, tested, rather than inside a component.
 */

import type { WorkItem, WorkKind } from "./work-queue";

export type WorkbenchPane =
  | "decide"
  | "reply"
  | "call"
  | "quote"
  | "bid"
  | "blocker"
  | "waiting";

const PANE_BY_KIND: Record<WorkKind, WorkbenchPane> = {
  read_reply: "reply",
  review_bid: "bid",
  enter_quote: "quote",
  call: "call",
  decide: "decide",
  fix_blocker: "blocker",
};

export function paneFor(item: Pick<WorkItem, "kind" | "waitingOn">): WorkbenchPane {
  /*
   * The wait beats the kind.
   *
   * An unanswered quote request arrives as `decide` because that is what it
   * eventually becomes. Opening it into the decision brief would put a
   * pursue-or-pass on a bid that was pursued a week ago, which is the wrong
   * question asked with a destructive button attached.
   */
  if (item.waitingOn) return "waiting";
  return PANE_BY_KIND[item.kind];
}

/** What the pane's heading says, in the operator's words. */
export const PANE_TITLE: Record<WorkbenchPane, string> = {
  decide: "Pursue or pass",
  reply: "Read the reply",
  call: "Make the call",
  quote: "Enter the price",
  bid: "Review and submit",
  blocker: "Clear the blocker",
  waiting: "Waiting on them",
};

/**
 * The one sentence under the heading: what finishing this item means.
 *
 * Written per pane rather than per item because it describes the ACT, not the
 * record, and an operator working forty items reads it once and stops seeing
 * it. The record's own reason line, which does change per item, sits beside
 * it.
 */
export const PANE_INTENT: Record<WorkbenchPane, string> = {
  decide: "Read the case, then pursue or pass. Nothing else moves until this is called.",
  reply: "The automatic reader would not act on this. Say what they meant and it is applied to this bid.",
  call: "The guided call, with the script and everything about the job on one screen.",
  quote: "Record what the subcontractor quoted. Entering the last trade starts the bid build.",
  bid: "The assembled package. Nothing goes to the agency until you approve it.",
  blocker: "Automation stopped and named what it could not get past.",
  waiting: "Sent and unanswered. Nudge them, call them, or leave the clock running.",
};

/**
 * Whether the pane's work can be finished here.
 *
 * True for everything except a wait, where the honest answer is that nothing
 * an operator does completes the item: the subcontractor does. Surfaces use
 * this to decide whether the foot of the pane offers a "done" at all, because
 * a Complete button on a task nobody here can complete teaches people to press
 * it to make the row go away.
 */
export function completableHere(pane: WorkbenchPane): boolean {
  return pane !== "waiting";
}

/**
 * A short label for the queue row, given the pane.
 *
 * The kind labels the queue already has answer "what sort of thing is this";
 * these answer "what am I about to do", which is what somebody scanning a
 * mixed queue is actually sorting on.
 */
export const PANE_CHIP: Record<WorkbenchPane, string> = {
  decide: "Decide",
  reply: "Reply",
  call: "Call",
  quote: "Quote",
  bid: "Bid",
  blocker: "Blocked",
  waiting: "Waiting",
};
