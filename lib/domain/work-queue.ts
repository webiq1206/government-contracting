/**
 * One queue for everything waiting on the operator.
 *
 * The platform's pending work has lived in three places: Review (borderline
 * scores), the Call Queue (prepared calls), and the needs-attention slices of
 * Today. Three destinations for one question, "what should I do next", is the
 * kind of navigation a mature CRM collapses into a single task list where
 * every row carries its own action.
 *
 * This module is that collapse, as data: each source becomes a WorkItem with
 * a kind, a plain-language ask, the record it belongs to, urgency, and the
 * one href that completes it. The UI renders the list; nothing here touches
 * the database, so the ordering rules are testable on their own.
 */

export type WorkKind =
  | "read_reply" // a sub answered and the reply needs a human's eyes
  | "decide" // pursue-or-pass on a borderline opportunity
  | "call" // a prepared call card
  | "enter_quote" // a sub replied or a trade needs pricing
  | "review_bid" // package built, needs review + submit
  | "fix_blocker"; // human_action_required with a named gap

export interface WorkItem {
  key: string;
  kind: WorkKind;
  /** Plain-language ask, e.g. "Call Rivera Mechanical about HVAC". */
  title: string;
  /** The record it belongs to, e.g. the opportunity title. */
  context: string;
  /** ISO deadline of the underlying opportunity, when known. */
  due?: string | null;
  /** Auto-dismiss or expiry moment, when the item has one. */
  expiresAt?: string | null;
  /** Where one tap takes you to complete the item. */
  href: string;
  /** Label for the inline action button. */
  actionLabel: string;
  /**
   * Why this is here, in one clause.
   *
   * Distinct from `title`, which is the ask. "Call Rivera Mechanical about
   * HVAC" says what to do; "no reply in 6 days and the bid is due Friday"
   * says why it is worth doing before the next thing. A queue that only says
   * what leaves the operator re-deriving the why for every row.
   */
  reason?: string | null;
  /**
   * What is stopping this from moving on its own, when something is.
   *
   * Empty for ordinary work. Present only where automation tried and could
   * not, which is exactly the case where a person cannot guess what happened.
   */
  blocker?: string | null;
}

/**
 * Collapse items that are the same problem seen from two places.
 *
 * An opportunity flagged for human attention can appear as both a blocker and
 * a bid to review; a subcontractor who replied can be both a reply to read and
 * a quote to enter. Each pair is one thing to do, and showing it twice makes
 * the queue longer without making it fuller -- and makes the count at the top
 * of Today disagree with the list underneath it.
 *
 * Keeps the item that comes first in queue order, since that is the one whose
 * action actually resolves the pair.
 */
export function dedupeWorkItems(items: WorkItem[]): WorkItem[] {
  const byRecord = new Map<string, WorkItem>();
  const out: WorkItem[] = [];
  for (const item of sortWorkItems(items)) {
    // The record id is the part of the key after the kind prefix.
    const record = item.key.slice(item.key.indexOf(":") + 1);
    if (!record) {
      out.push(item);
      continue;
    }
    const seen = byRecord.get(record);
    if (seen) continue;
    byRecord.set(record, item);
    out.push(item);
  }
  return out;
}

const KIND_ORDER: Record<WorkKind, number> = {
  // A reply outranks everything, even the bid review: a subcontractor who
  // answered is warm right now and cools by the hour, while the bid package
  // holds still. Answering fast is also what earns the next reply.
  read_reply: 0,
  review_bid: 1, // closest to money, always fewest in number
  enter_quote: 2,
  call: 3,
  decide: 4,
  fix_blocker: 5,
};

/**
 * Queue order: hard deadlines first inside each band, bands by how close the
 * item is to a submitted bid. A bid awaiting review outranks a call, which
 * outranks a triage decision; within a band the nearest deadline wins and
 * undated items sink.
 */
export function sortWorkItems(items: WorkItem[]): WorkItem[] {
  return [...items].sort((a, b) => {
    const band = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (band !== 0) return band;
    const ad = a.due ? new Date(a.due).getTime() : Number.POSITIVE_INFINITY;
    const bd = b.due ? new Date(b.due).getTime() : Number.POSITIVE_INFINITY;
    if (ad !== bd) return ad - bd;
    return a.title.localeCompare(b.title);
  });
}

/** "3 to do: 1 bid to review, 2 calls" — the queue's one-line summary. */
export function summarizeQueue(items: WorkItem[]): string {
  if (items.length === 0) return "Nothing waiting on you";
  const counts = new Map<WorkKind, number>();
  for (const i of items) counts.set(i.kind, (counts.get(i.kind) ?? 0) + 1);
  const LABEL: Record<WorkKind, [string, string]> = {
    read_reply: ["reply to read", "replies to read"],
    review_bid: ["bid to review", "bids to review"],
    enter_quote: ["quote to enter", "quotes to enter"],
    call: ["call", "calls"],
    decide: ["decision", "decisions"],
    fix_blocker: ["blocker", "blockers"],
  };
  const parts = [...counts.entries()]
    .sort((a, b) => KIND_ORDER[a[0]] - KIND_ORDER[b[0]])
    .map(([k, n]) => `${n} ${LABEL[k][n === 1 ? 0 : 1]}`);
  return `${items.length} to do: ${parts.join(", ")}`;
}
