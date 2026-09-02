/**
 * One definition of "what is still waiting on you", used by every surface that
 * puts a number on it.
 *
 * There were three, and they disagreed in public. Today summed eleven buckets
 * (app/(dash)/today/page.tsx), the Guide Me panel summed a different eight
 * (summarizeActions in page-guide.ts), and the work queue beneath them both
 * listed a third set -- so the same account could be told it had 56 things to
 * do, then 46, then see a list of neither length, on one screen. A person
 * cannot plan a morning around a number that changes depending on which part
 * of the page they read, and once one count is visibly wrong none of them are
 * believed again.
 *
 * The disagreement was never a bug in the arithmetic. It was three
 * independent answers to a question nobody had written down: what counts.
 * This module writes it down.
 *
 * Pure: the caller gathers the facts, this decides what they add up to.
 */

/** A named group of outstanding work, with where to go and what to call it. */
export interface LedgerBucket {
  key: string;
  /** Singular and plural, so callers never have to guess the wording. */
  label: [string, string];
  count: number;
  href: string;
}

export interface WorkLedger {
  buckets: LedgerBucket[];
  /** The one number. Every surface shows this or a subset it can name. */
  total: number;
  /** Where the most pressing work is, for a single primary action. */
  firstHref: string | null;
  firstLabel: string | null;
}

/**
 * The facts each bucket is counted from.
 *
 * Counts, not arrays, on purpose. Several of the underlying queries are
 * capped (`limit 10`, `limit 20`) because they also feed a preview list, and
 * counting the rows that came back reports the cap rather than the work:
 * an account with thirty borderline opportunities was told it had ten. A
 * caller that has only the capped list may pass its length, but a caller that
 * can count properly should.
 */
export interface LedgerInput {
  /** Deadline inside the urgent window and not yet submitted. */
  urgent: number;
  /** Subcontractor replies flagged for a human to read. */
  replyReviews: number;
  /** Borderline scores awaiting pursue-or-pass. */
  triage: number;
  /** Prepared call cards. */
  calls: number;
  /** Quotes to enter or a built package to review. */
  bidWork: number;
  /** Out-of-range quotes awaiting judgement. */
  quoteReviews: number;
  /** Subs needing a human follow-up after automated outreach. */
  subFollowUps: number;
  /** Our own registrations and licences past "ok". */
  compliance: number;
  /** Other people's paperwork on won work. */
  awardCompliance: number;
  /** Flagged outside the review queue (stalled, blocked). */
  flagged: number;
  /** Learning Loop weight proposals and backlink sends awaiting approval. */
  approvals: number;
}

/**
 * Ordered by what a person should do first, which is also the order the
 * primary action falls back through. A deadline that passes cannot be
 * recovered; a reply cools by the hour; an approval will wait.
 *
 * Deliberately NOT included in the total: work that is merely in flight.
 * "Submitted, awaiting the agency's decision" needs nobody, and counting it
 * as an action to take is how a clear morning still read as eleven jobs
 * outstanding. Today used to add it in.
 */
const ORDER: {
  key: keyof LedgerInput;
  label: [string, string];
  href: string;
  /** The primary-action wording when this bucket is the most pressing. */
  cta: string;
}[] = [
  { key: "urgent", label: ["urgent deadline", "urgent deadlines"], href: "/today#urgent", cta: "Handle urgent deadlines" },
  { key: "replyReviews", label: ["reply to read", "replies to read"], href: "/today#reply-reviews", cta: "Read subcontractor replies" },
  { key: "bidWork", label: ["bid to work", "bids to work"], href: "/today#bid-work", cta: "Continue bid work" },
  { key: "quoteReviews", label: ["quote to review", "quotes to review"], href: "/today#quotes", cta: "Review out-of-range quotes" },
  { key: "calls", label: ["call", "calls"], href: "/call-queue", cta: "Work the Call Queue" },
  { key: "triage", label: ["decision", "decisions"], href: "/review", cta: "Decide pursue or pass" },
  { key: "subFollowUps", label: ["follow-up", "follow-ups"], href: "/today#follow-ups", cta: "Follow up with subcontractors" },
  { key: "awardCompliance", label: ["subcontractor document", "subcontractor documents"], href: "/compliance", cta: "Chase subcontractor paperwork" },
  { key: "compliance", label: ["compliance item", "compliance items"], href: "/compliance", cta: "Clear compliance alerts" },
  { key: "flagged", label: ["blocked opportunity", "blocked opportunities"], href: "/today#flagged", cta: "Unblock stalled work" },
  { key: "approvals", label: ["approval", "approvals"], href: "/today#approvals", cta: "Review pending approvals" },
];

export function buildWorkLedger(input: LedgerInput): WorkLedger {
  const buckets: LedgerBucket[] = [];
  let firstHref: string | null = null;
  let firstLabel: string | null = null;

  for (const spec of ORDER) {
    const count = Math.max(0, Math.trunc(input[spec.key] ?? 0));
    if (count === 0) continue;
    buckets.push({ key: spec.key, label: spec.label, count, href: spec.href });
    if (!firstHref) {
      firstHref = spec.href;
      firstLabel = spec.cta;
    }
  }

  return {
    buckets,
    total: buckets.reduce((sum, b) => sum + b.count, 0),
    firstHref,
    firstLabel,
  };
}

/** "56 actions need you" -- the audit's wording, and the honest one. */
export function ledgerHeadline(ledgerOrTotal: WorkLedger | number): string {
  const total = typeof ledgerOrTotal === "number" ? ledgerOrTotal : ledgerOrTotal.total;
  if (total === 0) return "Nothing needs you";
  // "Decisions" was wrong as a label for the whole queue: it also holds calls,
  // deadlines, approvals and compliance work, none of which are decisions.
  return `${total} action${total === 1 ? "" : "s"} need${total === 1 ? "s" : ""} you`;
}

/** "1 bid to work, 2 calls, 3 decisions" -- the breakdown behind the number. */
export function ledgerBreakdown(ledger: WorkLedger, limit = 4): string {
  if (ledger.total === 0) return "";
  const parts = ledger.buckets
    .slice(0, limit)
    .map((b) => `${b.count} ${b.count === 1 ? b.label[0] : b.label[1]}`);
  const rest = ledger.buckets.length - Math.min(limit, ledger.buckets.length);
  if (rest > 0) parts.push(`${rest} more`);
  return parts.join(", ");
}
