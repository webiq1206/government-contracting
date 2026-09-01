/**
 * The shape of a daily recap, and the settings that govern one.
 *
 * Kept apart from the queries that fill it and the HTML that renders it, so
 * the same structure feeds the email, the dashboard page and the preview
 * without any of the three re-deciding what a section is. The three had better
 * agree: an operator who reads the mail and then opens the page is checking
 * our arithmetic, and two different answers is the worst outcome available.
 *
 * Pure. No imports that touch a database, a request or a clock.
 */

/**
 * The eight sections, in the fixed order they always appear.
 *
 * Order is not configurable and the array below is the authority. A recap is
 * read in fifteen seconds before the working day starts; the value is in the
 * shape being the same every morning, so the eye knows where to land.
 */
export const RECAP_SECTION_KEYS = [
  "urgent",
  "problems",
  "review",
  "totals",
  "bids",
  "outreach",
  "completed",
  "upcoming",
] as const;

export type RecapSectionKey = (typeof RECAP_SECTION_KEYS)[number];

export const RECAP_SECTION_TITLES: Record<RecapSectionKey, string> = {
  urgent: "Urgent attention required",
  problems: "System or integration problems",
  review: "Items requiring review or action",
  totals: "Key activity totals",
  bids: "Solicitation and bid progress",
  outreach: "Subcontractor outreach and responses",
  completed: "Completed work",
  upcoming: "Upcoming deadlines and next actions",
};

/** What each section is for, in the operator's language. */
export const RECAP_SECTION_BLURBS: Record<RecapSectionKey, string> = {
  urgent: "Deadlines, unanswered replies and failures that cost you something if they wait.",
  problems: "Anything that stopped the automation from doing its job.",
  review: "Decisions and queues waiting on a person.",
  totals: "What the day added up to. Every figure links to the records behind it.",
  bids: "Solicitations that arrived, decisions made, and bids that went out.",
  outreach: "Who was contacted, who wrote back, and what they said.",
  completed: "Work that finished yesterday, so it is off your list.",
  upcoming: "What is coming, in the order it lands.",
};

/**
 * A single thing worth naming, always with a way to reach it.
 *
 * `href` is a path, not a URL. The absolute address is assembled at render
 * time from the configured app URL, because the same recap is rendered into an
 * email (needs absolute) and into a page (wants relative), and storing one
 * form would make the other wrong.
 */
export interface RecapItem {
  /**
   * Stable across mornings. "deadline:<opportunity id>", not a row id from
   * whatever query produced it: this is what makes an item four days old
   * rather than four separate pieces of news.
   */
  key: string;
  title: string;
  detail?: string;
  href?: string;
  /**
   * The record's own page, when `href` goes somewhere the work gets done.
   *
   * A row for a borderline opportunity links into the workbench, which is
   * where the decision is actually made. That link is not a record address,
   * so the preview pane has nothing to read it from. This is that address,
   * carried separately: what the row is about, as opposed to where the row
   * takes you.
   */
  recordHref?: string;
  /** Mornings this item has already appeared on. 0 means it is new today. */
  ageDays?: number;
  /** Why it is urgent, when it is. */
  reason?: string;
  /** Timing in words: "due in 6 hours", "waiting since Friday". */
  when?: string;
  /**
   * How loud to be. Never carried by colour alone at render time: each level
   * also gets a word and a shape, because a recap read in a monochrome client
   * or by somebody who does not see red has to carry the same information.
   */
  severity?: "critical" | "warning" | "normal";
}

/** One number in the totals section, with the records behind it one click away. */
export interface RecapTotal {
  label: string;
  value: number;
  href?: string;
  /** The caveat that keeps the figure honest: "3 of these failed to send". */
  note?: string;
}

export interface RecapSection {
  key: RecapSectionKey;
  title: string;
  blurb: string;
  /** Rendered above the fold and visually distinct. Only ever the two. */
  emphasis: "urgent" | "problem" | "normal";
  items: RecapItem[];
  totals: RecapTotal[];
  /** What to say when the section is empty. Never left blank. */
  empty: string;
}

export interface Recap {
  scope: "org" | "platform";
  orgId: string | null;
  orgName: string | null;
  /** The day being summarised, in the reader's zone. */
  localDate: string;
  timezone: string;
  /** "Saturday, August 29". */
  dayLabel: string;
  /** Nothing of consequence happened; the short variant is appropriate. */
  quiet: boolean;
  urgentCount: number;
  problemCount: number;
  sections: RecapSection[];
  /** ISO instant this was assembled. Shown in the footer. */
  generatedAt: string;
  /** True when this covers a day still in progress (the dashboard's "today"). */
  partial: boolean;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface RecapUrgentThresholds {
  /** A bid deadline inside this many hours is urgent. */
  deadline_hours: number;
  /** A subcontractor reply unanswered this long is urgent. */
  unanswered_reply_hours: number;
  /** This many failed sends in the day is urgent. */
  failed_send_count: number;
  /** A compliance item due inside this many days is urgent. */
  compliance_days: number;
  /** A review item expiring inside this many hours is urgent. */
  review_expiry_hours: number;
}

export interface RecapSettings {
  enabled: boolean;
  /** "HH:MM" in each recipient's own zone. */
  send_at: string;
  /** Which sections to include. Order is fixed regardless of this list. */
  sections: RecapSectionKey[];
  /** Org roles that receive it. */
  recipient_roles: string[];
  /** Named people who receive it whatever their role. */
  recipient_user_ids: string[];
  /** People excluded by an admin, whatever their role. */
  excluded_user_ids: string[];
  urgent: RecapUrgentThresholds;
  /** Send the short "nothing happened" variant instead of eight empty sections. */
  quiet_when_empty: boolean;
  /** Skip the send entirely on a quiet day. Off by default: silence is ambiguous. */
  skip_when_empty: boolean;
  /** A missed morning is still worth sending for this many hours. */
  late_cutoff_hours: number;
}

export const DEFAULT_RECAP_SETTINGS: RecapSettings = {
  enabled: true,
  send_at: "06:00",
  sections: [...RECAP_SECTION_KEYS],
  // The two roles that run the account. An operator works from the Today page,
  // which is live; the recap exists for the people who are not in the product
  // all day.
  recipient_roles: ["owner", "admin"],
  recipient_user_ids: [],
  excluded_user_ids: [],
  urgent: {
    deadline_hours: 48,
    unanswered_reply_hours: 24,
    failed_send_count: 1,
    compliance_days: 7,
    review_expiry_hours: 24,
  },
  quiet_when_empty: true,
  skip_when_empty: false,
  late_cutoff_hours: 12,
};

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function uuidList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const raw of v) {
    if (typeof raw !== "string") continue;
    const s = raw.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) continue;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

const KNOWN_ROLES = ["owner", "admin", "operator", "estimator", "member", "viewer"];

/**
 * Fill in what is missing and refuse what is impossible.
 *
 * The stored blob is a partial by design: adding a setting must not require a
 * migration over everybody's row, and a value nobody has chosen should follow
 * the default as the default changes. Every field is clamped rather than
 * rejected, because this is a settings form, not an API contract, and the
 * useful behaviour for "1000 hours" is 168, not an error the operator has to
 * decode.
 */
export function normalizeRecapSettings(input: Partial<RecapSettings> | null | undefined): RecapSettings {
  const src = (input ?? {}) as Partial<RecapSettings>;
  const d = DEFAULT_RECAP_SETTINGS;

  const sections = Array.isArray(src.sections)
    ? RECAP_SECTION_KEYS.filter((k) => (src.sections as string[]).includes(k))
    : [...d.sections];

  const roles = Array.isArray(src.recipient_roles)
    ? Array.from(
        new Set(
          (src.recipient_roles as string[])
            .map((r) => String(r ?? "").trim().toLowerCase())
            .filter((r) => KNOWN_ROLES.includes(r))
        )
      )
    : [...d.recipient_roles];

  const urgentSrc = (src.urgent ?? {}) as Partial<RecapUrgentThresholds>;

  return {
    enabled: src.enabled !== false,
    send_at: normalizeSendAt(src.send_at),
    /*
     * An empty section list would be an email with a header and nothing
     * underneath it. Read it as "not configured" and restore the default,
     * rather than sending a blank page every morning until somebody notices.
     */
    sections: sections.length > 0 ? sections : [...d.sections],
    // Same reasoning: nobody at all means nobody gets it, which is what the
    // enabled switch is for.
    recipient_roles: roles.length > 0 ? roles : [...d.recipient_roles],
    recipient_user_ids: uuidList(src.recipient_user_ids),
    excluded_user_ids: uuidList(src.excluded_user_ids),
    urgent: {
      deadline_hours: clampInt(urgentSrc.deadline_hours, 1, 336, d.urgent.deadline_hours),
      unanswered_reply_hours: clampInt(
        urgentSrc.unanswered_reply_hours,
        1,
        336,
        d.urgent.unanswered_reply_hours
      ),
      failed_send_count: clampInt(urgentSrc.failed_send_count, 1, 500, d.urgent.failed_send_count),
      compliance_days: clampInt(urgentSrc.compliance_days, 1, 90, d.urgent.compliance_days),
      review_expiry_hours: clampInt(
        urgentSrc.review_expiry_hours,
        1,
        336,
        d.urgent.review_expiry_hours
      ),
    },
    quiet_when_empty: src.quiet_when_empty !== false,
    skip_when_empty: src.skip_when_empty === true,
    late_cutoff_hours: clampInt(src.late_cutoff_hours, 1, 23, d.late_cutoff_hours),
  };
}

function normalizeSendAt(value: unknown): string {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(typeof value === "string" ? value : "");
  if (!m) return DEFAULT_RECAP_SETTINGS.send_at;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return DEFAULT_RECAP_SETTINGS.send_at;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// The facts a recap is built from
// ---------------------------------------------------------------------------

export interface DeadlineFact {
  id: string;
  title: string;
  agency: string | null;
  deadline: string;
  stage: string;
  status: string;
  submitted: boolean;
  quotesIn: number;
}

export interface ReplyFact {
  id: string;
  subcontractorId: string | null;
  subcontractor: string | null;
  opportunityId: string | null;
  opportunity: string | null;
  intent: string | null;
  needsReview: boolean;
  reviewedAt: string | null;
  createdAt: string;
}

export interface FailedSendFact {
  id: string;
  subcontractorId: string | null;
  subcontractor: string | null;
  recipient: string | null;
  opportunityId: string | null;
  state: string;
  detail: string | null;
  createdAt: string;
}

export interface ComplianceFact {
  id: string;
  label: string;
  category: string | null;
  status: string;
  dueAt: string | null;
}

export interface ReviewFact {
  id: string;
  title: string;
  score: number | null;
  tier: string | null;
  expiresAt: string | null;
}

export interface CallFact {
  id: string;
  opportunityId: string | null;
  opportunity: string | null;
  subcontractorId: string | null;
  subcontractor: string | null;
  createdAt: string;
}

export interface DraftFact {
  id: string;
  subcontractorId: string | null;
  subcontractor: string | null;
  opportunityId: string | null;
  generatedAt: string;
}

export interface ProblemFact {
  /** Stable across mornings, so a problem can age too. */
  key: string;
  title: string;
  detail: string | null;
  count: number;
  lastAt: string | null;
  href?: string;
  severity: "critical" | "warning";
}

export interface OpportunityFact {
  id: string;
  title: string;
  agency: string | null;
  score: number | null;
  tier: string | null;
  deadline: string | null;
  stage: string;
  value: number | null;
}

export interface BidFact {
  id: string;
  opportunityId: string;
  title: string;
  amount: number | null;
  outcome: string | null;
  at: string;
}

export interface OutreachSubFact {
  id: string;
  subcontractor: string | null;
  subcontractorId: string | null;
  opportunityId: string | null;
  opportunity: string | null;
  state: string;
  at: string;
}

export interface RecapTotals {
  opportunitiesDiscovered: number;
  decisionsMade: number;
  outreachSent: number;
  outreachDelivered: number;
  outreachFailed: number;
  repliesReceived: number;
  repliesNeedingReview: number;
  draftsGenerated: number;
  callsLogged: number;
  quotesRecorded: number;
  bidsSubmitted: number;
  notesAdded: number;
  subsAdded: number;
  complianceResolved: number;
  agentRuns: number;
  agentRunErrors: number;
}

/**
 * Everything the queries found, before any judgement is applied.
 *
 * Deliberately raw: no copy, no ordering, no urgency. Those are decisions, and
 * decisions belong in one pure function that can be tested without a database.
 */
export interface RecapFacts {
  orgId: string | null;
  orgName: string | null;
  totals: RecapTotals;
  /** Deadlines ahead of `now`, nearest first. Not limited to the day. */
  deadlines: DeadlineFact[];
  /** Replies received in the window, plus older ones still unanswered. */
  replies: ReplyFact[];
  unansweredReplies: ReplyFact[];
  failedSends: FailedSendFact[];
  compliance: ComplianceFact[];
  reviewQueue: ReviewFact[];
  callQueue: CallFact[];
  draftsWaiting: DraftFact[];
  problems: ProblemFact[];
  discovered: OpportunityFact[];
  decided: (OpportunityFact & { decision: string })[];
  submitted: BidFact[];
  outcomes: BidFact[];
  outreachSent: OutreachSubFact[];
  completed: { key: string; label: string; detail: string | null; href?: string; at: string }[];
  /** Platform scope only: one line per account. */
  accounts?: {
    id: string;
    name: string;
    urgentCount: number;
    problemCount: number;
    outreachSent: number;
    repliesReceived: number;
    bidsSubmitted: number;
  }[];
}
