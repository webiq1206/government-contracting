/**
 * Intake rules + deadline urgency, pure and unit-tested.
 *
 * Two jobs:
 *  1. deadlineStatus(): one consistent answer to "how close is this deadline"
 *     (normal / approaching / urgent / past due), with configurable day
 *     thresholds, used by the badge shown on every list and detail view.
 *  2. intakeChecks(): the quality gate every new opportunity passes before it
 *     can enter the active pipeline: minimum lead time, missing deadline,
 *     duplicate solicitation number. Each finding says what failed, why it
 *     matters, and what happens next, nothing is excluded silently.
 */

// ---------------------------------------------------------------------------
// Configuration (stored in app_settings, editable on Settings → Automation rules)
// ---------------------------------------------------------------------------

export interface AutomationRules {
  /**
   * Minimum days between ingest and the submission deadline for an opportunity
   * to be workable. 0 disables the rule.
   */
  min_lead_days: number;
  /** What to do when an opportunity fails the lead-time rule. */
  lead_action: "dismiss" | "review";
  /** Deadline badge: "approaching" when within this many days. */
  approaching_days: number;
  /** Deadline badge: "urgent" when within this many days. */
  urgent_days: number;
  /**
   * Days to keep archived (dismissed/expired) opportunities before permanent
   * deletion. 0 = keep forever (default). Records with bids or contracts are
   * never auto-deleted regardless of this setting.
   */
  retention_days: number;
  /**
   * Whether the pipeline includes the phone-call step at all.
   *
   * False = email-only: no call card is ever prepared, the call stage is
   * skipped, and an opportunity advances the moment its outreach email is
   * sent. Emails, follow-ups, and reply capture are untouched. Defaults to
   * true so an existing install keeps the calling workflow it already has.
   */
  calls_enabled: boolean;
  /**
   * Hours to wait after the first outreach email before following up.
   *
   * Was hardcoded at 48 in the outreach agent. It is a rule about how often
   * this platform contacts other people's businesses, which makes it exactly
   * the kind of thing the operator should be able to see and set rather than
   * discover from a subcontractor's complaint.
   */
  followup_hours: number;
  /**
   * How many follow-ups a subcontractor may receive per opportunity, after
   * the first email.
   *
   * Previously fixed at one, not by decision but by structure: the send
   * consumed `follow_up_at` and nothing ever set it again. One remains the
   * default, so an existing install behaves exactly as it did. Zero means
   * never chase.
   */
  followup_max: number;
  /** Follow-ups sent per run, so one sweep cannot empty a backlog in a burst. */
  outreach_batch_limit: number;
  /**
   * The earliest and latest hour, in the subcontractor's own local time, at
   * which the call queue will offer them up.
   *
   * The queue already worked out their local time and showed it. Nothing
   * stopped it handing somebody a card at five in the morning their time,
   * which is a rule this product was silently leaving to the operator to
   * notice on the phone.
   */
  call_hours_start: number;
  call_hours_end: number;
  /**
   * Unanswered call attempts before the queue stops offering a contact.
   *
   * Attempts were counted and displayed and never acted on, so a number that
   * had rung out eleven times kept coming back to the top of somebody's day.
   * Zero means no limit, which is the old behaviour, stated.
   */
  call_max_attempts: number;
}

export const DEFAULT_RULES: AutomationRules = {
  min_lead_days: 0,
  lead_action: "review",
  approaching_days: 7,
  urgent_days: 3,
  retention_days: 30,  // 30 days; set to 0 in Settings to keep archived records forever
  calls_enabled: true, // calling is part of the pipeline unless the operator turns it off
  // Every default below reproduces what the code already did, so turning these
  // into settings changes nothing until somebody changes one.
  followup_hours: 48,
  followup_max: 1,
  outreach_batch_limit: 50,
  call_hours_start: 8,
  call_hours_end: 17,
  call_max_attempts: 3,
};

/** Merge a stored partial config over the defaults, clamping nonsense. */
export function normalizeRules(v: Partial<AutomationRules> | null | undefined): AutomationRules {
  const num = (x: unknown, fallback: number, min = 0, max = 3650) => {
    // null and "" both coerce to 0, and 0 is a meaningful value for several of
    // these rules, so an absent key was being stored as "no limit" rather than
    // as the default. Rejected before Number() rather than after it, because
    // afterwards the two are indistinguishable.
    if (x == null || x === "") return fallback;
    const n = Number(x);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  };
  const r: AutomationRules = {
    min_lead_days: num(v?.min_lead_days, DEFAULT_RULES.min_lead_days),
    lead_action: v?.lead_action === "dismiss" ? "dismiss" : "review",
    approaching_days: num(v?.approaching_days, DEFAULT_RULES.approaching_days, 1),
    urgent_days: num(v?.urgent_days, DEFAULT_RULES.urgent_days, 1),
    retention_days: num(v?.retention_days, DEFAULT_RULES.retention_days),
    // Only an explicit false turns calling off. A stored config written before
    // this setting existed has no key at all, and must keep its calls.
    calls_enabled: v?.calls_enabled !== false,
    // Never below an hour: a follow-up interval of nought would resend the
    // moment the first message left, which is not a follow-up, it is a loop.
    followup_hours: num(v?.followup_hours, DEFAULT_RULES.followup_hours, 1, 720),
    followup_max: num(v?.followup_max, DEFAULT_RULES.followup_max, 0, 5),
    outreach_batch_limit: num(v?.outreach_batch_limit, DEFAULT_RULES.outreach_batch_limit, 1, 500),
    call_hours_start: num(v?.call_hours_start, DEFAULT_RULES.call_hours_start, 0, 23),
    call_hours_end: num(v?.call_hours_end, DEFAULT_RULES.call_hours_end, 0, 23),
    call_max_attempts: num(v?.call_max_attempts, DEFAULT_RULES.call_max_attempts, 0, 20),
  };
  // "Urgent" must be inside "approaching", or the badge tiers stop nesting.
  if (r.urgent_days > r.approaching_days) r.urgent_days = r.approaching_days;
  // A window that ends before it starts is not a window. Rather than silently
  // swapping the two, which would enforce hours nobody chose, it collapses to
  // the start hour: one hour a day is visibly wrong and gets fixed, where a
  // quietly reversed window looks correct and calls people at midnight.
  if (r.call_hours_end < r.call_hours_start) r.call_hours_end = r.call_hours_start;
  return r;
}

/**
 * Rules that contradict each other or contradict themselves.
 *
 * The audit asks for conflicts to be shown before publishing. These are the
 * pairs that are individually legal and jointly incoherent, so no single
 * field's validation can catch them.
 */
export interface RuleConflict {
  severity: "error" | "warning";
  message: string;
}

export function ruleConflicts(r: AutomationRules): RuleConflict[] {
  const out: RuleConflict[] = [];
  if (r.urgent_days > r.approaching_days) {
    out.push({
      severity: "error",
      message:
        "The red warning starts further out than the amber one, so nothing would ever be amber.",
    });
  }
  if (r.call_hours_end < r.call_hours_start) {
    out.push({
      severity: "error",
      message: "Calling hours end before they start, which leaves no hours at all.",
    });
  }
  if (r.calls_enabled && r.call_hours_end - r.call_hours_start < 2) {
    out.push({
      severity: "warning",
      message:
        "A calling window under two hours wide means most of the queue is never callable, so calls will pile up rather than get made.",
    });
  }
  if (r.min_lead_days > 0 && r.approaching_days > r.min_lead_days) {
    out.push({
      severity: "warning",
      message:
        "Every opportunity you accept arrives already inside the amber deadline window, so the colour will never mean anything.",
    });
  }
  if (r.followup_max > 0 && r.followup_hours * r.followup_max < 24) {
    out.push({
      severity: "warning",
      message:
        "Every follow-up would land within a day of the first email. That reads as pestering and is the fastest way to a spam complaint.",
    });
  }
  if (r.retention_days > 0 && r.retention_days < r.approaching_days) {
    out.push({
      severity: "warning",
      message:
        "Archived records are deleted sooner than an opportunity spends in its deadline warning window, so history will disappear while work is still live.",
    });
  }
  if (!r.calls_enabled && r.call_max_attempts !== DEFAULT_RULES.call_max_attempts) {
    out.push({
      severity: "warning",
      message: "Calling is switched off, so the call rules below have nothing to apply to.",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Deadline urgency
// ---------------------------------------------------------------------------

export type DeadlineKey = "none" | "normal" | "approaching" | "urgent" | "past_due";

export interface DeadlineStatus {
  key: DeadlineKey;
  /** Written status, always shown next to the color so meaning never relies on color alone. */
  label: string;
  /** Whole days remaining (floor); negative once past due; null without a deadline. */
  daysRemaining: number | null;
}

const MS_PER_DAY = 86_400_000;

export function deadlineStatus(
  deadline: string | Date | null | undefined,
  now: Date,
  rules: Pick<AutomationRules, "approaching_days" | "urgent_days"> = DEFAULT_RULES
): DeadlineStatus {
  if (!deadline) return { key: "none", label: "No deadline on record", daysRemaining: null };
  const due = new Date(deadline).getTime();
  if (!Number.isFinite(due)) return { key: "none", label: "No deadline on record", daysRemaining: null };
  const msLeft = due - now.getTime();
  const daysRemaining = Math.floor(msLeft / MS_PER_DAY);

  if (msLeft < 0) {
    return { key: "past_due", label: "Past due", daysRemaining };
  }
  if (daysRemaining < rules.urgent_days) {
    return {
      key: "urgent",
      label: daysRemaining === 0 ? "Urgent, due today" : `Urgent, ${daysRemaining}d left`,
      daysRemaining,
    };
  }
  if (daysRemaining < rules.approaching_days) {
    return { key: "approaching", label: `Approaching, ${daysRemaining}d left`, daysRemaining };
  }
  return { key: "normal", label: `${daysRemaining}d left`, daysRemaining };
}

// ---------------------------------------------------------------------------
// Intake quality gate
// ---------------------------------------------------------------------------

export interface IntakeInput {
  deadline: string | null;
  /** Open opportunities (other records) sharing this solicitation number. */
  duplicateSolicitationCount: number;
  rules: AutomationRules;
  now: Date;
}

export interface IntakeFinding {
  rule: "min_lead_time" | "missing_deadline" | "duplicate_solicitation";
  /** dismiss = archive immediately; review = force the human review queue. */
  verdict: "dismiss" | "review";
  /** risk_flags key persisted on the opportunity. */
  flag: string;
  /** Full plain-English explanation logged and shown to the operator. */
  explanation: string;
}

export function intakeChecks(i: IntakeInput): IntakeFinding[] {
  const findings: IntakeFinding[] = [];

  if (!i.deadline) {
    findings.push({
      rule: "missing_deadline",
      verdict: "review",
      flag: "missing_deadline",
      explanation:
        "No submission deadline was found on this notice. Without a deadline the platform cannot schedule the work or guarantee an on-time bid, so it needs a human to confirm the real due date before the pipeline runs.",
    });
  } else if (i.rules.min_lead_days > 0) {
    const { daysRemaining } = deadlineStatus(i.deadline, i.now, i.rules);
    if (daysRemaining != null && daysRemaining < i.rules.min_lead_days) {
      const due = new Date(i.deadline).toISOString().slice(0, 10);
      findings.push({
        rule: "min_lead_time",
        verdict: i.rules.lead_action,
        flag: "below_min_lead_time",
        explanation:
          `Deadline ${due} is ${Math.max(daysRemaining, 0)} day(s) away; your minimum lead time is ${i.rules.min_lead_days} days. ` +
          `That window is too short to analyze the solicitation, find and verify subs, collect quotes, build the package, and submit with a safety margin. ` +
          (i.rules.lead_action === "dismiss"
            ? "Per your settings it was auto-passed."
            : "Per your settings it was routed to your review queue instead of the automatic pipeline."),
      });
    }
  }

  if (i.duplicateSolicitationCount > 0) {
    findings.push({
      rule: "duplicate_solicitation",
      verdict: "review",
      flag: "possible_duplicate",
      explanation:
        `Another open opportunity already has this solicitation number (${i.duplicateSolicitationCount} match${
          i.duplicateSolicitationCount === 1 ? "" : "es"
        }). Ingest normally blocks this; if you still see it, a human should decide which record to keep before both run through the pipeline.`,
    });
  }

  return findings;
}

/** The overall gate decision: dismiss wins over review; empty = proceed. */
export function intakeVerdict(findings: IntakeFinding[]): "proceed" | "review" | "dismiss" {
  if (findings.some((f) => f.verdict === "dismiss")) return "dismiss";
  if (findings.length > 0) return "review";
  return "proceed";
}
