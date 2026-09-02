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

import { matchesOwner, type Owner, type OwnerFilter } from "./ownership";

export type WorkKind =
  | "read_reply" // a sub answered and the reply needs a human's eyes
  | "decide" // pursue-or-pass on a borderline opportunity
  | "call" // a prepared call card
  | "enter_quote" // a sub replied or a trade needs pricing
  | "review_bid" // package built, needs review + submit
  | "fix_blocker"; // human_action_required with a named gap

/**
 * The kind of record a task is a view of.
 *
 * A task in this product has no independent existence: it is a record in a
 * state that needs somebody. Naming the record is what lets a workspace open
 * the task itself rather than merely linking to the page the record lives on,
 * which is the difference between finishing forty things and visiting forty
 * pages.
 */
export type WorkRecordKind = "opportunity" | "call_card" | "reply" | "pairing";

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
  /**
   * Where one tap takes you to complete the item.
   *
   * The workbench, for everything. This used to be a different destination per
   * kind -- an anchor on Today for a reply, the call queue for a call, one of
   * four anchors on the record page for the rest -- so the one list of work
   * was a list of six places to go, and finishing five items meant loading
   * five pages and finding your way back each time.
   */
  href: string;
  /**
   * The record's own page, for when somebody genuinely wants the whole thing.
   *
   * Kept alongside `href` rather than replacing it. Working an item and
   * studying a record are different acts, and a workspace that cannot hand off
   * to the full record traps people in it.
   */
  recordHref: string;
  /**
   * The record behind the task, for surfaces that open it in place.
   *
   * Optional because `href` is still the answer for anything that only wants
   * to link somewhere, and because the key already encodes the id for the
   * dedupe. This says WHAT the id is, which a string prefix cannot.
   */
  record?: { kind: WorkRecordKind; id: string };
  /**
   * The solicitation the task belongs to, when the record above is not itself
   * one. A call card and a subcontractor pairing are both about a bid, and a
   * workspace showing one without naming the other is a screen you cannot act
   * from.
   */
  opportunityId?: string | null;
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
  /**
   * Who owes us the next move, when it is not us.
   *
   * Distinct from `blocker`, and the distinction is the whole point. A blocker
   * is something that went wrong and needs fixing. Waiting on somebody is the
   * system working correctly: the packet went out, the deadline has not
   * arrived, and there is nothing for the operator to do but let the clock
   * run.
   *
   * Without the separation both look the same on a list, so an operator
   * reading a long queue cannot tell the eight items that need them from the
   * twelve that do not, and the honest answer to "how much is on me this
   * morning" is unavailable on the page built to answer it.
   */
  waitingOn?: { party: string; since?: string | null } | null;
  /**
   * Who here is doing it, when somebody has said.
   *
   * A different question from `waitingOn`, which names a party outside the
   * company. On a one-person account this is obvious and nobody asks; on a
   * five-person account it is the question, and its absence has a specific
   * failure mode: everything looks like it is on everybody, so the items that
   * go overdue are the ones each person assumed the other had picked up.
   *
   * Null means unassigned, which is a real answer rather than a missing one.
   * Nothing guesses: the account's owner is not the owner of every record in
   * it merely because they signed up.
   */
  owner?: Owner | null;
  /**
   * What can be done to this task without leaving the list.
   *
   * The queue's rows were links and nothing else, so completing a decision
   * meant opening the record, deciding, and coming back to a list that had
   * moved. The themed sections lower down the page had these controls all
   * along, which made the one list the least capable place to work from.
   *
   * Only what genuinely applies. A reply waiting to be read has no snooze
   * target, because the thing to snooze would be the conversation, and a
   * conversation somebody is waiting on is not something to hide.
   */
  actions?: {
    /** Hide it until a chosen time. The record it belongs to, and its kind. */
    snooze?: { kind: "opportunity" | "call_card"; id: string };
    /** Pursue or pass, for a task that is genuinely that decision. */
    decide?: { opportunityId: string; title: string };
    /**
     * Who the call is to, for the controls that have to name them.
     *
     * Skipping a call asks why and how far the decision reaches, and both
     * questions are about a firm rather than a card id. The title says
     * "Call Rivera Mechanical about HVAC" and parsing the name back out of a
     * sentence is a bug waiting for a firm called "about".
     */
    call?: {
      companyName: string;
      trade?: string | null;
      subcontractorId?: string | null;
    };
  };
}

/**
 * The stable identity of a task, across every surface that shows it.
 *
 * Two rows are the same task when they are about the same record, whatever
 * kind they arrived as: an opportunity flagged for attention can surface as a
 * blocker and as a bid to review, and those are one thing to do. dedupe has
 * always keyed on this; naming it makes it something a caller can ask for,
 * which is what a count on one screen needs in order to match a list on
 * another.
 */
export function taskFingerprint(item: WorkItem): string {
  const at = item.key.indexOf(":");
  return at === -1 ? item.key : item.key.slice(at + 1) || item.key;
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

/** Every kind, including zeroes, so a missing kind is 0 rather than absent. */
export function countByKind(items: WorkItem[]): Record<WorkKind, number> {
  const counts = {
    read_reply: 0,
    review_bid: 0,
    enter_quote: 0,
    call: 0,
    decide: 0,
    fix_blocker: 0,
  };
  for (const i of items) counts[i.kind] += 1;
  return counts;
}

/** "3 to do: 1 bid to review, 2 calls" — the queue's one-line summary. */
export function summarizeQueue(items: WorkItem[]): string {
  if (items.length === 0) return "Nothing waiting on you";
  const counts = countByKind(items);
  const LABEL: Record<WorkKind, [string, string]> = {
    read_reply: ["reply to read", "replies to read"],
    review_bid: ["bid to review", "bids to review"],
    enter_quote: ["quote to enter", "quotes to enter"],
    call: ["call", "calls"],
    decide: ["decision", "decisions"],
    fix_blocker: ["blocker", "blockers"],
  };
  const parts = (Object.keys(KIND_ORDER) as WorkKind[])
    .filter((k) => counts[k] > 0)
    .sort((a, b) => KIND_ORDER[a] - KIND_ORDER[b])
    .map((k) => `${counts[k]} ${LABEL[k][counts[k] === 1 ? 0 : 1]}`);
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
  /**
   * Still open, and not due today: a later deadline, or no date at all.
   * Never "the rest of the day" as a vague leftover.
   */
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
 * Whose move it is. A separate axis from the date buckets above.
 *
 * Every item is exactly one of these three, and an item also sits in exactly
 * one date bucket, so the two cut across each other: work can be overdue AND
 * waiting on somebody else, which is a specific and common situation worth
 * being able to see.
 */
export type QueueState = "needs_attention" | "blocked" | "waiting_on_others";

export function stateOf(item: WorkItem): QueueState {
  // Blocked first: something that went wrong outranks something merely
  // pending, and an item can carry both when a send failed to a contact we
  // were already waiting on.
  if (item.blocker) return "blocked";
  if (item.waitingOn) return "waiting_on_others";
  return "needs_attention";
}

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

/**
 * Work that still needs a person.
 *
 * Quote requests that are out and unanswered stay on the list under
 * "Waiting on others", but they are not actions. Counting them in the
 * headline is how a morning of in-flight packets read as 404 things to do.
 */
export function needsYou(items: WorkItem[]): WorkItem[] {
  return items.filter((item) => stateOf(item) !== "waiting_on_others");
}

/** The one number every Today surface is allowed to print. */
export function needsYouCount(items: WorkItem[]): number {
  return needsYou(items).length;
}

/**
 * The filters the queue offers, in the order they are shown.
 *
 * Two axes in one control, deliberately. `overdue`, `due_today` and
 * `remaining` cut by date; `needs_attention`, `waiting_on_others` and
 * `blocked` cut by whose move it is. Selecting one applies one cut, which is
 * how somebody actually narrows a list: "what is late" and "what is on me"
 * are separate questions and either can be the one being asked.
 *
 * `completed_today` is one of them, and it is the one this queue cannot
 * answer. The queue is what is LEFT, so deriving completions from it would
 * give the same answer for "nothing to do" and "everything done", which are
 * opposite mornings. It is listed here because it is a cut of the same list
 * from the operator's side of the screen, and served from the ledger of what
 * happened rather than from what remains. See filterQueue below, which refuses
 * it rather than quietly returning the wrong rows.
 */
export const QUEUE_FILTERS = [
  "all",
  "needs_attention",
  "overdue",
  "due_today",
  "waiting_on_others",
  "blocked",
  "remaining",
  "completed_today",
] as const;
export type QueueFilter = (typeof QUEUE_FILTERS)[number];

export const QUEUE_FILTER_LABEL: Record<QueueFilter, string> = {
  all: "Everything",
  needs_attention: "Needs you",
  overdue: "Overdue",
  due_today: "Due today",
  waiting_on_others: "Waiting on others",
  blocked: "Blocked",
  remaining: "Later",
  completed_today: "Completed today",
};

/**
 * The one filter that is not a cut of the queue.
 *
 * Callers have to fetch it from somewhere else, and this is how they know to.
 * A helper rather than a string comparison at four call sites, because the
 * failure mode of getting it wrong is a page that says nothing was finished
 * today.
 */
export function isCompletedFilter(f: QueueFilter): boolean {
  return f === "completed_today";
}

/** Which axis a filter cuts on, so callers do not have to know the list. */
const STATE_FILTERS: Partial<Record<QueueFilter, QueueState>> = {
  needs_attention: "needs_attention",
  waiting_on_others: "waiting_on_others",
  blocked: "blocked",
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
  opts: {
    bucket?: QueueFilter;
    kind?: WorkKind | null;
    q?: string;
    /** Whose work to show. Needs viewerId to mean anything but "anyone". */
    owner?: OwnerFilter;
    viewerId?: string;
  },
  now = new Date()
): WorkItem[] {
  if (opts.bucket && isCompletedFilter(opts.bucket)) {
    /*
     * Refused rather than answered.
     *
     * This list is what is LEFT, so every completed item is by definition
     * absent from it. Falling through would return an empty array, and an
     * empty array here looks exactly like a day on which nothing was
     * finished: the wrong answer, delivered confidently. Callers fetch
     * completions from the ledger instead.
     */
    throw new Error("completed_today is not a cut of the queue; read the ledger");
  }
  const needle = opts.q?.trim().toLowerCase() ?? "";
  return items.filter((item) => {
    if (opts.bucket && opts.bucket !== "all") {
      const wantState = STATE_FILTERS[opts.bucket];
      if (wantState) {
        if (stateOf(item) !== wantState) return false;
      } else if (bucketOf(item, now) !== opts.bucket) {
        return false;
      }
    }
    if (opts.kind && item.kind !== opts.kind) return false;
    /*
     * The owner cut, applied last of the structured ones.
     *
     * Without a viewer id "on me" has no meaning, so it is treated as no
     * filter rather than as nothing matching. A page that silently shows an
     * empty list because it forgot to say who is looking is worse than one
     * that shows everything.
     */
    if (opts.owner && opts.owner !== "anyone" && opts.viewerId) {
      if (!matchesOwner(item.owner, opts.owner, opts.viewerId)) return false;
    }
    if (needle) {
      const hay = `${item.title} ${item.context} ${item.reason ?? ""}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}
