/**
 * What a bulk change to the roster is allowed to be.
 *
 * Bulk verify, tag and archive were left unbuilt on purpose, with a note
 * saying why: they each write to a roster shared across live bids, and a
 * button that changes two hundred rows with no way back is worse than no
 * button. So the shape here is built around the undo rather than the write.
 *
 * Pure.
 */

export const BULK_KINDS = ["verify", "tag", "untag", "archive"] as const;
export type BulkKind = (typeof BULK_KINDS)[number];

export const BULK_LABEL: Record<BulkKind, string> = {
  verify: "Re-check contact details",
  tag: "Add a tag",
  untag: "Remove a tag",
  archive: "Put aside",
};

/**
 * Whether a batch of this kind can be taken back, and what taking it back
 * means.
 *
 * Verifying is not undoable and does not need to be: it re-reads the world
 * and writes down what it found. Undoing it would mean restoring a stale
 * answer, which is worse than the fresh one whichever way it went.
 */
export const BULK_REVERSIBLE: Record<BulkKind, boolean> = {
  verify: false,
  tag: true,
  untag: true,
  archive: true,
};

export const BULK_UNDO_LABEL: Record<BulkKind, string | null> = {
  verify: null,
  tag: "Remove the tag again",
  untag: "Put the tag back",
  archive: "Bring them back onto the roster",
};

/** Why a named row was not changed. Always specific, never "skipped". */
export type SkipReason =
  | "not_found"
  | "already"
  | "blocked"
  | "merged"
  | "nothing_to_check"
  | "automation_paused";

export const SKIP_REASON_TEXT: Record<SkipReason, string> = {
  not_found: "no longer on the roster",
  already: "already in that state",
  blocked: "marked do not use",
  merged: "folded into another record",
  nothing_to_check: "no website or email to check",
  /*
   * enqueue() returns null rather than throwing when automation is paused.
   * Counting those rows as queued would have the batch report work that will
   * never happen, and the operator would go looking for results that are not
   * coming.
   */
  automation_paused: "not queued, because automation is paused",
};

export interface BulkSkip {
  id: string;
  reason: SkipReason;
}

export interface BulkOutcome {
  kind: BulkKind;
  changed: number;
  skipped: BulkSkip[];
  batchId: string | null;
}

/**
 * One sentence for what a batch did, including what it did not do.
 *
 * Written here rather than at each call site so the count in the message and
 * the count in the ledger cannot drift, and so "27 were not changed" always
 * arrives with the reason attached.
 */
export function describeOutcome(o: BulkOutcome): string {
  const noun = o.changed === 1 ? "firm" : "firms";
  const head =
    o.changed === 0
      ? "Nothing changed."
      : `${o.changed} ${noun} ${o.kind === "verify" ? "queued for a re-check" : "updated"}.`;
  if (o.skipped.length === 0) return head;

  const byReason = new Map<SkipReason, number>();
  for (const s of o.skipped) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
  const parts = [...byReason.entries()].map(
    ([reason, n]) => `${n} ${SKIP_REASON_TEXT[reason]}`
  );
  return `${head} ${o.skipped.length} left alone: ${parts.join(", ")}.`;
}

/** A tag somebody typed, as it will be stored and compared. */
export function normalizeTag(raw: string): string | null {
  const t = raw.trim().replace(/\s+/g, " ");
  if (!t || t.length > 40) return null;
  return t;
}

/**
 * The most rows one action may touch at a time.
 *
 * Not a technical limit. A change larger than this is one nobody has read the
 * list for, and the undo it would need is the kind that gets used in a panic.
 */
export const BULK_LIMIT = 500;
