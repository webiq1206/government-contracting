/**
 * Where a recap row sends you.
 *
 * The recap and the workbench describe the same work in different words. The
 * recap says "Rivera Mechanical is waiting on an answer"; the workbench holds
 * the item that answers them. Until now the recap only ever linked to a page
 * where the thing could be *read* -- the opportunity record, the call queue,
 * the subcontractor's file -- so the morning list of eleven things to do was
 * eleven trips out to find the control that finishes each one.
 *
 * These are the links that finish them instead. They are here, as pure
 * functions over the facts, rather than inline in `sections.ts`, because the
 * mapping is the part that can silently rot: the recap's queries and the
 * workbench's queries are written separately, and a row that points at a
 * workbench item the workbench would not list lands you on somebody else's
 * work with no sign that it happened.
 *
 * So each function below is narrow on purpose, and only returns a workbench
 * link where the recap's own filter is a subset of the workbench's:
 *
 *   review  recap: tier=review, human_action_required, open, not snoozed
 *           bench: tier=review, human_action_required, open
 *           -> subset. Always finishable.
 *
 *   call    recap: pending card, open opportunity, not snoozed, has a phone
 *           bench: pending card, open opportunity
 *           -> subset. Always finishable.
 *
 *   reply   recap: any reply in 21 days with no outbound after it
 *           bench: needs_review and not yet reviewed
 *           -> NOT a subset. Most unanswered replies are ones the reader
 *              handled confidently and nobody flagged; those have no
 *              workbench item at all. The fact carries both flags, so we can
 *              tell the two apart exactly rather than guessing, and only the
 *              flagged ones go to the workbench. The rest go where they have
 *              always gone: the subcontractor's own file, whose
 *              communications tab reads the thread and answers it in place.
 *
 * A draft waiting to be sent has no workbench item of any kind, so it is not
 * here.
 */

/** The workbench, opened on one item. */
export function workbenchHref(key: string): string {
  return `/workbench?i=${encodeURIComponent(key)}`;
}

/** The subcontractor's file, or the inbox when the reply has no sender on it. */
function subcontractorHref(subcontractorId: string | null | undefined): string {
  return subcontractorId ? `/subs/${subcontractorId}` : "/communications";
}

/**
 * An unanswered reply.
 *
 * Flagged for review and not yet read -> the workbench, which shows their
 * words, the thread, and the controls that record what the reply meant.
 * Anything else -> their file, where the thread can be read and answered.
 */
export function replyDestination(reply: {
  id: string;
  needsReview: boolean;
  reviewedAt: string | null;
  subcontractorId: string | null;
}): string {
  if (reply.needsReview && reply.reviewedAt == null) {
    return workbenchHref(`reply:${reply.id}`);
  }
  return subcontractorHref(reply.subcontractorId);
}

/** A borderline opportunity waiting on a pursue-or-pass. */
export function reviewDestination(opportunityId: string): string {
  return workbenchHref(`decide:${opportunityId}`);
}

/** A prepared call card. */
export function callDestination(callCardId: string): string {
  return workbenchHref(`call:${callCardId}`);
}

/** A drafted reply nobody has sent. No workbench item exists for one. */
export function draftDestination(subcontractorId: string | null): string {
  return subcontractorHref(subcontractorId);
}
