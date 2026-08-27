/**
 * The state of one compliance item, in eight words that mean eight things.
 *
 * The vocabulary was `ok | warning | critical | blocked | resolved`, displayed
 * in words like Warning and Critical. Three of those
 * are severity words rather than states: "Critical" is how urgent something is,
 * not what is true about it, and an item that is missing, one that has lapsed
 * and one whose two sources disagree were all Critical and all read the same.
 *
 * The worst of them was the green one. It was shown for any item the monitor
 * had not flagged, including items with no expiry date at all, which is a
 * claim about the future made from no evidence: a registration nobody had
 * checked in a year read exactly like one renewed last week.
 *
 * These eight say what is true. The state is computed from the facts on every
 * read rather than trusted from the stored column, because a row written last
 * month cannot know that a certificate lapsed yesterday. The stored value is a
 * cache; this is the answer.
 *
 * Pure.
 */

export const COMPLIANCE_STATES = [
  "conflicting",
  "expired",
  "blocked",
  "needs_review",
  "expiring_soon",
  "cannot_monitor",
  "incomplete",
  "complete",
] as const;

export type ComplianceState = (typeof COMPLIANCE_STATES)[number];

export const COMPLIANCE_STATE_LABEL: Record<ComplianceState, string> = {
  conflicting: "Conflicting",
  expired: "Expired",
  blocked: "Blocked",
  needs_review: "Needs human review",
  expiring_soon: "Expiring soon",
  cannot_monitor: "Cannot monitor",
  incomplete: "Incomplete",
  complete: "Complete",
};

/**
 * The order they rank when more than one is true, worst first.
 *
 * Conflicting comes first, above even an expired certificate, because an
 * expired one is a fact you can act on and a conflicting one is not: you do
 * not know which source is right, so every action you take might be the wrong
 * one. Fixing the disagreement comes before acting on either side of it.
 *
 * "Cannot monitor" ranks above "Incomplete" because it explains why nobody
 * knows, which is more use than asserting an incompleteness we cannot check.
 */
export const COMPLIANCE_STATE_ORDER: ComplianceState[] = [...COMPLIANCE_STATES];

export interface ComplianceFacts {
  /** True when this item is required rather than merely tracked. */
  required?: boolean;
  /** When the obligation was satisfied, if it has been. */
  satisfiedAt?: string | Date | null;
  /** When it lapses. Null means it does not lapse, or nobody has recorded one. */
  expiresAt?: string | Date | null;
  /** When a person last confirmed it against a document. */
  verifiedAt?: string | Date | null;
  /**
   * Whether the platform can check this itself.
   *
   * False is a real answer, not a failure: a state licence with no public
   * register cannot be checked, and saying so is better than a green badge
   * nobody has earned.
   */
  monitorable?: boolean;
  /** What has to happen first, when something does. */
  blockedBy?: string | null;
  /** Set when two sources disagree, naming the disagreement. */
  conflict?: string | null;
  /** Set when a machine reading wants a person to confirm it. */
  needsReview?: string | null;
  /** How many days ahead counts as expiring rather than current. */
  windowDays?: number;
  /** An operator's explicit statement, which beats everything computed. */
  override?: ComplianceState | null;
}

export interface ComplianceVerdict {
  state: ComplianceState;
  label: string;
  /** Why, in a sentence. Never a bare badge. */
  detail: string;
  /** What to do about it, when there is something. */
  fix: string | null;
  /** Days until it lapses. Null when no date is on file, never 0. */
  daysLeft: number | null;
  /** True when an operator said so rather than the platform working it out. */
  fromOperator: boolean;
}

/** Default window. Overridable per item, because a bond is not a W-9. */
export const DEFAULT_WINDOW_DAYS = 30;

function asDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function complianceState(f: ComplianceFacts, now = new Date()): ComplianceVerdict {
  const expires = asDate(f.expiresAt);
  const daysLeft =
    expires === null ? null : Math.ceil((expires.getTime() - now.getTime()) / 86_400_000);

  if (f.override) {
    return {
      state: f.override,
      label: COMPLIANCE_STATE_LABEL[f.override],
      detail: "Set by somebody here, rather than worked out from the dates.",
      fix: null,
      daysLeft,
      fromOperator: true,
    };
  }

  const conflict = f.conflict?.trim();
  if (conflict) {
    return {
      state: "conflicting",
      label: COMPLIANCE_STATE_LABEL.conflicting,
      detail: `Two sources disagree: ${conflict}`,
      /*
       * Ranked above expired deliberately. An expired certificate is a fact
       * you can act on; a conflicting one is not, and acting on either side
       * of a disagreement is how the wrong one gets believed.
       */
      fix: "Settle which is right before acting on either.",
      daysLeft,
      fromOperator: false,
    };
  }

  if (daysLeft !== null && daysLeft <= 0) {
    const overdue = Math.abs(daysLeft);
    return {
      state: "expired",
      label: COMPLIANCE_STATE_LABEL.expired,
      detail:
        overdue === 0
          ? "It lapses today."
          : `It lapsed ${overdue} ${overdue === 1 ? "day" : "days"} ago.`,
      fix: "Renew it, then record the new date.",
      daysLeft,
      fromOperator: false,
    };
  }

  const blockedBy = f.blockedBy?.trim();
  if (blockedBy) {
    return {
      state: "blocked",
      label: COMPLIANCE_STATE_LABEL.blocked,
      detail: `Waiting on something else: ${blockedBy}`,
      fix: null,
      daysLeft,
      fromOperator: false,
    };
  }

  const review = f.needsReview?.trim();
  if (review) {
    return {
      state: "needs_review",
      label: COMPLIANCE_STATE_LABEL.needs_review,
      detail: review,
      // Named as a person's job rather than left as a status nobody owns.
      fix: "Somebody here has to confirm this against the document.",
      daysLeft,
      fromOperator: false,
    };
  }

  const window = f.windowDays ?? DEFAULT_WINDOW_DAYS;
  if (daysLeft !== null && daysLeft <= window) {
    return {
      state: "expiring_soon",
      label: COMPLIANCE_STATE_LABEL.expiring_soon,
      detail: `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left.`,
      fix: "Start the renewal now, so it does not lapse while it is in a queue.",
      daysLeft,
      fromOperator: false,
    };
  }

  const satisfied = asDate(f.satisfiedAt);

  if (f.monitorable === false) {
    /*
     * A real answer, not a failure. Some obligations have no public register
     * and no expiry anybody publishes, and a green badge on one of those is a
     * claim the platform has not earned. The item still needs a person; it
     * just cannot have a date attached to it by us.
     */
    return {
      state: "cannot_monitor",
      label: COMPLIANCE_STATE_LABEL.cannot_monitor,
      detail: satisfied
        ? "Recorded here, and nothing we can check confirms it is still current."
        : "There is nothing the platform can check for this one.",
      fix: "Check it yourself and record the date, or it will never move.",
      daysLeft,
      fromOperator: false,
    };
  }

  if (!satisfied) {
    return {
      state: "incomplete",
      label: COMPLIANCE_STATE_LABEL.incomplete,
      detail: f.required
        ? "Required, and nothing on file."
        : "Nothing on file yet.",
      fix: "Get the document, then record it here.",
      daysLeft,
      fromOperator: false,
    };
  }

  return {
    state: "complete",
    label: COMPLIANCE_STATE_LABEL.complete,
    detail:
      daysLeft === null
        ? asDate(f.verifiedAt)
          ? "On file and checked. No expiry date, so nothing to count down."
          : "On file. No expiry date, so nothing to count down."
        : `On file, with ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left.`,
    fix: null,
    daysLeft,
    fromOperator: false,
  };
}

/** Whether this state should be in front of somebody today. */
export function needsAttention(state: ComplianceState): boolean {
  return state === "conflicting" || state === "expired" || state === "blocked" ||
    state === "needs_review" || state === "expiring_soon";
}

/** The badge tone, so every screen colours these the same. */
export const COMPLIANCE_STATE_TONE: Record<ComplianceState, string> = {
  conflicting: "bg-risk/15 text-risk",
  expired: "bg-risk/15 text-risk",
  blocked: "bg-risk/10 text-risk",
  needs_review: "bg-review/15 text-review",
  expiring_soon: "bg-review/15 text-review",
  cannot_monitor: "bg-surface-raised text-slate-600",
  incomplete: "bg-surface-raised text-slate-600",
  complete: "bg-pursue-soft text-pursue-strong",
};

/**
 * The old stored values, and what each one meant.
 *
 * Kept so rows written before this vocabulary existed still read as something
 * rather than falling through to a default. `ok` is deliberately not mapped to
 * `complete`: it meant "the monitor did not flag this", which on an item with
 * no date on file is exactly the unearned claim this vocabulary replaces.
 */
export const LEGACY_STATUS: Record<string, ComplianceState | null> = {
  ok: null,
  warning: "expiring_soon",
  critical: "expired",
  blocked: "blocked",
  resolved: "complete",
};

export function fromLegacyStatus(value: string | null | undefined): ComplianceState | null {
  if (!value) return null;
  if ((COMPLIANCE_STATES as readonly string[]).includes(value)) return value as ComplianceState;
  return LEGACY_STATUS[value] ?? null;
}
