/**
 * The window between deciding to delete an account and the data going.
 *
 * Deletion used to be immediate, and the page said so plainly: no undo, no
 * backup. The confirmation is typing the account's name, which rules out
 * misclicks, so the mistakes this guards against are not slips but decisions:
 * the wrong one of two similarly named accounts, a cancellation the customer
 * reverses the next morning, a support request somebody misread. None of those
 * is recoverable from a transaction that has already committed.
 *
 * A scheduled deletion gives the administrator what they actually wanted
 * immediately, which is for the account to stop working, and defers the part
 * that cannot be taken back. Cancelling inside the window restores everything,
 * because nothing has been touched: the data was never the thing that changed.
 */

/** How long a scheduled deletion waits before the data is destroyed. */
export const DELETION_GRACE_DAYS = 30;

const DAY = 86_400_000;

export type DeletionState = "none" | "scheduled" | "due";

export interface DeletionView {
  state: DeletionState;
  /** Days until the purge. Negative once it is overdue, null when none is scheduled. */
  daysLeft: number | null;
  headline: string;
  /** What is kept, and what will not be, in the operator's words. */
  retention: string;
  /** Whether an administrator should be looking at this now. */
  urgent: boolean;
}

function asDate(v: Date | string | null | undefined): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * What is kept and for how long, stated the same way everywhere it appears.
 *
 * The audit asks permanent deletion to explain retention. The honest answer
 * has two halves that are easy to conflate: the customer's data goes
 * completely, and the record that an administrator deleted it does not,
 * because erasing the evidence of a deletion alongside the deletion is how an
 * audit log stops being one.
 */
export const RETENTION_EXPLANATION =
  "Everything in the account goes: opportunities, subcontractors, quotes, bids, contracts, documents and messages. The audit entry recording who deleted it, when and why is kept, because a log that erases its own deletions is not a log.";

export function deletionView(
  scheduledAt: Date | string | null | undefined,
  now = new Date()
): DeletionView {
  const at = asDate(scheduledAt);
  if (!at) {
    return {
      state: "none",
      daysLeft: null,
      headline: "No deletion scheduled",
      retention: RETENTION_EXPLANATION,
      urgent: false,
    };
  }
  // Rounded up, so an account with nineteen hours left reads "1 day" rather
  // than "0 days", which would look like it had already gone.
  const daysLeft = Math.ceil((at.getTime() - now.getTime()) / DAY);
  if (daysLeft <= 0) {
    return {
      state: "due",
      daysLeft,
      headline: "Deletion is due and will run on the next sweep",
      retention: RETENTION_EXPLANATION,
      urgent: true,
    };
  }
  return {
    state: "scheduled",
    daysLeft,
    headline: `Scheduled for deletion in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
    retention: RETENTION_EXPLANATION,
    urgent: daysLeft <= 3,
  };
}

/** When a deletion requested now would actually run. */
export function purgeDueAt(now = new Date(), graceDays = DELETION_GRACE_DAYS): Date {
  return new Date(now.getTime() + graceDays * DAY);
}

/**
 * Whether an account may be scheduled for deletion at all.
 *
 * Deliberately separate from the name confirmation, which is about intent.
 * This is about the two states where deletion is the wrong instrument: our own
 * account, which would lock us out of the product used to administer every
 * other one, and an account already scheduled, where pressing again should
 * change nothing rather than quietly restarting the clock.
 */
export function deletionBlockedReason(input: {
  isOwnAccount: boolean;
  alreadyScheduled: boolean;
}): string | null {
  if (input.isOwnAccount) {
    return "This is our own account. Deleting it would remove the product used to administer every other account.";
  }
  if (input.alreadyScheduled) {
    return "This account is already scheduled for deletion. Cancel it first if the date needs to change.";
  }
  return null;
}
