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

// ---------------------------------------------------------------------------
// The four counters, and filtering the queue by them
// ---------------------------------------------------------------------------

/**
 * The four numbers the audit asks Today to lead with.
 *
 * `Needs you` on its own answers "how much", which is the least useful of the
 * questions somebody opening this page has. Overdue and due-today answer "how
 * much of it is already late", which is what decides whether the morning is a
 * normal one.
 *
 * `completedToday` is deliberately not in here. It is not a property of the
 * queue -- the queue is what is left -- and deriving it from an empty queue
 * would produce the same number for "nothing to do" and "everything done",
 * which are opposite mornings. It comes from the activity ledger instead.
 */
export interface QueueCounts {
  overdue: number;
  dueToday: number;
  /** Everything else still waiting, including work with no date at all. */
  remaining: number;
  total: number;
}

/** Local-day boundaries, so "today" means the operator's today. */
function dayBounds(now: Date): { start: number; end: number } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return { start, end: start + 86_400_000 };
}

export type QueueBucket = "overdue" | "due_today" | "remaining";

/**
 * Which counter an item belongs to.
 *
 * An item with no date is `remaining`, never `overdue`. Treating an absent
 * deadline as a passed one is the same lie as showing 0 for an unknown count,
 * and on this page it would fill the overdue counter with work that is not
 * late and has no way of becoming late.
 */
export function bucketOf(item: WorkItem, now = new Date()): QueueBucket {
  if (!item.due) return "remaining";
  const t = new Date(item.due).getTime();
  if (Number.isNaN(t)) return "remaining";
  const { start, end } = dayBounds(now);
  if (t < start) return "overdue";
  if (t < end) return "due_today";
  return "remaining";
}

export function queueCounts(items: WorkItem[], now = new Date()): QueueCounts {
  const counts: QueueCounts = { overdue: 0, dueToday: 0, remaining: 0, total: items.length };
  for (const item of items) {
    const b = bucketOf(item, now);
    if (b === "overdue") counts.overdue += 1;
    else if (b === "due_today") counts.dueToday += 1;
    else counts.remaining += 1;
  }
  return counts;
}

/** The filters the queue offers, in the order they are shown. */
export const QUEUE_FILTERS = ["all", "overdue", "due_today", "remaining"] as const;
export type QueueFilter = (typeof QUEUE_FILTERS)[number];

export const QUEUE_FILTER_LABEL: Record<QueueFilter, string> = {
  all: "Everything",
  overdue: "Overdue",
  due_today: "Due today",
  remaining: "Remaining",
};

export function parseQueueFilter(raw: string | string[] | undefined): QueueFilter {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (QUEUE_FILTERS as readonly string[]).includes(v ?? "") ? (v as QueueFilter) : "all";
}

/** The kinds, as a filter. Same vocabulary the queue itself uses. */
export const KIND_FILTER_LABEL: Record<WorkKind, string> = {
  read_reply: "Replies",
  review_bid: "Bids",
  enter_quote: "Quotes",
  call: "Calls",
  decide: "Decisions",
  fix_blocker: "Blockers",
};

export function parseKindFilter(raw: string | string[] | undefined): WorkKind | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && v in KIND_FILTER_LABEL ? (v as WorkKind) : null;
}

/**
 * Apply the filters. Text matches the ask, the record and the reason, because
 * an operator searching "Rivera" is as likely to be thinking of the
 * subcontractor named in the reason as of the one in the title.
 */
export function filterWorkItems(
  items: WorkItem[],
  opts: { bucket?: QueueFilter; kind?: WorkKind | null; q?: string },
  now = new Date()
): WorkItem[] {
  const needle = opts.q?.trim().toLowerCase() ?? "";
  return items.filter((item) => {
    if (opts.bucket && opts.bucket !== "all") {
      const want = opts.bucket === "due_today" ? "due_today" : opts.bucket;
      if (bucketOf(item, now) !== want) return false;
    }
    if (opts.kind && item.kind !== opts.kind) return false;
    if (needle) {
      const hay = `${item.title} ${item.context} ${item.reason ?? ""}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}
