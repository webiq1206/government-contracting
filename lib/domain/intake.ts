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
}

export const DEFAULT_RULES: AutomationRules = {
  min_lead_days: 0,
  lead_action: "review",
  approaching_days: 7,
  urgent_days: 3,
  retention_days: 30,  // 30 days; set to 0 in Settings to keep archived records forever
};

/** Merge a stored partial config over the defaults, clamping nonsense. */
export function normalizeRules(v: Partial<AutomationRules> | null | undefined): AutomationRules {
  const num = (x: unknown, fallback: number, min = 0, max = 3650) => {
    const n = Number(x);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  };
  const r: AutomationRules = {
    min_lead_days: num(v?.min_lead_days, DEFAULT_RULES.min_lead_days),
    lead_action: v?.lead_action === "dismiss" ? "dismiss" : "review",
    approaching_days: num(v?.approaching_days, DEFAULT_RULES.approaching_days, 1),
    urgent_days: num(v?.urgent_days, DEFAULT_RULES.urgent_days, 1),
    retention_days: num(v?.retention_days, DEFAULT_RULES.retention_days),
  };
  // "Urgent" must be inside "approaching", or the badge tiers stop nesting.
  if (r.urgent_days > r.approaching_days) r.urgent_days = r.approaching_days;
  return r;
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
        }). It may be an amendment, a repost, or a cross-portal duplicate. A human should decide which record to keep before both run through the pipeline and double the outreach.`,
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
