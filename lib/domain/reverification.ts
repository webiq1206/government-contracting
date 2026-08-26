/**
 * Checking a solicitation against its source again, and being honest about
 * what the check established.
 *
 * The button this replaces would have been easy to write: re-run the analyst,
 * overwrite the record, mark it verified. That is not verification, it is
 * repetition. A model asked the same question twice tends to give the same
 * answer twice, including when the answer was wrong, and the second run
 * produces no new information while looking exactly like confirmation.
 *
 * So the rules below are about what may be concluded rather than what to run:
 *
 * Identical output is not proof. The evidence that counts is deterministic:
 * the source's own amendment list, content hashes, a document inventory built
 * from scratch rather than trusted, page counts, and citations that resolve.
 *
 * A partial check is never a clean one. If four of nine documents could not be
 * opened, the record is partially verified and says so. "Verified" with a
 * quarter of the pages unread is the statement this module exists to prevent,
 * because it is the one that stops anybody looking again.
 *
 * And a change is not an update. New facts are compared to the record, not
 * written over it. A deadline that moved earlier is a blocker somebody has to
 * see, not a field that quietly changed while nobody was watching.
 *
 * Pure. The clock is always passed in.
 */

/**
 * What a verification can be, and every state it can end in.
 *
 * Nine, because collapsing them is how a run that failed halfway ends up
 * displayed the same as one that found nothing wrong.
 */
export const VERIFICATION_STATES = [
  "not_verified",
  "queued",
  "in_progress",
  "verified_no_changes",
  "changes_found",
  "conflicts_found",
  "partially_verified",
  "failed",
  "stale",
] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

export const STATE_LABEL: Record<VerificationState, string> = {
  not_verified: "Never checked against the source",
  queued: "Check queued",
  in_progress: "Checking now",
  verified_no_changes: "Checked, nothing changed",
  changes_found: "Changes found, review needed",
  conflicts_found: "Conflicts found, decision needed",
  partially_verified: "Partly checked, some documents unread",
  failed: "The check could not complete",
  stale: "Last check is out of date",
};

/**
 * Fails closed. Anything unrecognised reads as never checked, which is the
 * only safe reading of a state this code does not understand.
 */
export function parseVerificationState(v: unknown): VerificationState {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return (VERIFICATION_STATES as readonly string[]).includes(s)
    ? (s as VerificationState)
    : "not_verified";
}

/** True when the state permits saying the record matches its source. */
export function claimsVerified(state: VerificationState): boolean {
  return state === "verified_no_changes";
}

export const VERIFICATION_SCOPES = [
  "source_and_amendments",
  "documents",
  "requirements_and_deadlines",
  "trade_scopes",
  "scoring_and_eligibility",
  "bid_readiness",
  "full",
] as const;
export type VerificationScope = (typeof VERIFICATION_SCOPES)[number];

export const SCOPE_LABEL: Record<VerificationScope, string> = {
  source_and_amendments: "Check source and amendments",
  documents: "Reverify documents",
  requirements_and_deadlines: "Reverify requirements and deadlines",
  trade_scopes: "Reverify trade scopes",
  scoring_and_eligibility: "Reverify scoring and eligibility",
  bid_readiness: "Reverify bid readiness",
  full: "Full solicitation reverify",
};

/**
 * What each scope depends on, so a full run happens in an order that means
 * something.
 *
 * Requirements extracted from documents nobody re-downloaded are requirements
 * extracted from last week, and a score recalculated before the requirements
 * were checked is a score of the old solicitation.
 */
export const SCOPE_DEPENDENCIES: Record<VerificationScope, VerificationScope[]> = {
  source_and_amendments: [],
  documents: ["source_and_amendments"],
  requirements_and_deadlines: ["documents"],
  trade_scopes: ["requirements_and_deadlines"],
  scoring_and_eligibility: ["requirements_and_deadlines"],
  bid_readiness: ["trade_scopes", "scoring_and_eligibility"],
  full: [],
};

/** The scopes a full run performs, in dependency order. */
export const FULL_ORDER: VerificationScope[] = [
  "source_and_amendments",
  "documents",
  "requirements_and_deadlines",
  "trade_scopes",
  "scoring_and_eligibility",
  "bid_readiness",
];

export interface RecommendationInput {
  now: Date;
  /** When a full check last completed, or null when none ever has. */
  lastFullAt: Date | null;
  /** Hours after which a full check is considered out of date. */
  freshnessHours: number;
  /** The source reported an amendment since the last check. */
  amendmentDetected: boolean;
  /** A document's hash, version or availability changed. */
  documentsChanged: boolean;
  /** An unresolved disagreement is on file. */
  conflictOpen: boolean;
  /** The bid is close enough to submission that a surprise is expensive. */
  approachingSubmission: boolean;
}

export interface Recommendation {
  scope: VerificationScope;
  /** Why this one, in the words the button's help text uses. */
  because: string;
  /** True when the current record cannot be relied on until this runs. */
  urgent: boolean;
}

/**
 * Which check to offer, and why.
 *
 * The default is deliberately the expensive one whenever anything suggests the
 * record has moved. A narrow check that happens to pass is the most expensive
 * possible outcome: it costs the same attention as a full one and licenses a
 * confidence nothing earned.
 */
export function recommendScope(input: RecommendationInput): Recommendation {
  if (input.amendmentDetected) {
    return {
      scope: "full",
      because: "The source has published an amendment since this was last checked.",
      urgent: true,
    };
  }
  if (input.conflictOpen) {
    return {
      scope: "full",
      because: "There is an unresolved disagreement about what this solicitation requires.",
      urgent: true,
    };
  }
  if (input.documentsChanged) {
    return {
      scope: "full",
      because: "A document changed, so everything read out of the documents is in question.",
      urgent: true,
    };
  }
  if (input.lastFullAt == null) {
    return {
      scope: "full",
      because: "This solicitation has never been checked against its source.",
      urgent: true,
    };
  }
  const ageHours = (input.now.getTime() - input.lastFullAt.getTime()) / 3_600_000;
  if (ageHours >= input.freshnessHours) {
    return {
      scope: "full",
      because: `The last full check was ${Math.floor(ageHours / 24)} days ago.`,
      urgent: input.approachingSubmission,
    };
  }
  if (input.approachingSubmission) {
    return {
      scope: "bid_readiness",
      because: "This is close to going out, so the package and the evidence are worth rechecking.",
      urgent: false,
    };
  }
  return {
    scope: "source_and_amendments",
    because: "Everything checked recently. A quick look for new amendments is enough.",
    urgent: false,
  };
}

// ---------------------------------------------------------------------------
// What a comparison found
// ---------------------------------------------------------------------------

export const CHANGE_KINDS = [
  "added",
  "removed",
  "changed",
  "unchanged",
  "conflict",
  "unreadable",
] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

/**
 * How much a change costs.
 *
 * `safe_metadata` is the only class that may be applied without somebody
 * looking: a corrected agency name, a source URL that moved. Everything that
 * touches eligibility, a date, the scope, the packet, the price or how the bid
 * is delivered is material by definition, whatever it looks like.
 */
export const IMPACT = ["safe_metadata", "material", "blocking"] as const;
export type Impact = (typeof IMPACT)[number];

export interface Finding {
  /** Which check produced it. */
  scope: VerificationScope;
  /** What changed, as a field or document name a person recognises. */
  subject: string;
  kind: ChangeKind;
  impact: Impact;
  /** The value on file. */
  before: string | null;
  /** The value the source now carries. */
  after: string | null;
  /** Where it was read, so the claim can be checked. */
  citation?: string | null;
  /** One sentence on what this costs. */
  note?: string | null;
}

/**
 * Fields that can never be a safe automatic correction.
 *
 * Listed rather than judged case by case, because "it is only a small change"
 * is exactly the reasoning that applies a new deadline silently.
 */
const NEVER_AUTOMATIC = [
  "deadline",
  "due",
  "close",
  "timezone",
  "set aside",
  "naics",
  "eligib",
  "trade",
  "scope",
  "price",
  "pricing",
  "submission",
  "form",
  "signature",
  "bond",
  "insurance",
  "wage",
];

/**
 * True when a change to this field must be reviewed rather than applied.
 *
 * Separators are normalised first. The list originally carried `set_aside`,
 * which is how the column is spelled and not how the label is, so a finding
 * about "Set aside" passed the guard that exists to catch exactly that field.
 * Every caller here hands over a human-readable name.
 */
export function mustBeReviewed(field: string): boolean {
  const f = field.toLowerCase().replace(/[_\-/]+/g, " ").replace(/\s+/g, " ").trim();
  return NEVER_AUTOMATIC.some((n) => f.includes(n));
}

export interface Coverage {
  documentsExpected: number;
  documentsVerified: number;
  documentsUnreadable: number;
  pagesProcessed: number;
}

/** Fraction of the expected documents that were actually read, 0 to 1. */
export function coverageRatio(c: Coverage): number {
  if (c.documentsExpected <= 0) return 0;
  return Math.min(1, c.documentsVerified / c.documentsExpected);
}

export interface OutcomeInput {
  findings: Finding[];
  coverage: Coverage;
  /** True when the run stopped before finishing its scopes. */
  aborted: boolean;
  /** Scopes that could not run at all. */
  failedScopes: VerificationScope[];
}

/**
 * The state a completed run may claim.
 *
 * The order of these checks is the whole point. Failure beats everything,
 * partial beats "no changes", and conflict beats "changes found", because at
 * every one of those forks the wrong answer is the reassuring one.
 */
export function outcomeState(input: OutcomeInput): VerificationState {
  if (input.aborted || input.failedScopes.length >= FULL_ORDER.length) return "failed";

  const unreadable = input.coverage.documentsUnreadable > 0;
  const incomplete =
    input.coverage.documentsExpected > 0 &&
    input.coverage.documentsVerified < input.coverage.documentsExpected;

  if (input.findings.some((f) => f.kind === "conflict")) return "conflicts_found";
  if (input.failedScopes.length > 0 || unreadable || incomplete) return "partially_verified";
  if (input.findings.some((f) => f.kind !== "unchanged")) return "changes_found";
  return "verified_no_changes";
}

/**
 * One sentence for the header, which must never overstate the run.
 *
 * `partially_verified` says how much was actually read, because "partly
 * checked" without a number reads as a rounding error rather than as four
 * documents nobody opened.
 */
export function outcomeSummary(state: VerificationState, coverage: Coverage): string {
  const pct = Math.round(coverageRatio(coverage) * 100);
  switch (state) {
    case "verified_no_changes":
      return `Checked against the source. ${coverage.documentsVerified} documents, ${coverage.pagesProcessed} pages, nothing changed.`;
    case "changes_found":
      return "The source has changed since this record was written. Review the differences before this bid goes anywhere.";
    case "conflicts_found":
      return "The independent read disagrees with what is on file. Somebody has to decide which is right.";
    case "partially_verified":
      return `Only ${pct}% of the expected documents could be read. What is on file is unchanged and unproven, not confirmed.`;
    case "failed":
      return "The check could not complete. The previous record is unchanged and is not verified.";
    case "stale":
      return "The last check is old enough that the record may no longer match the source.";
    case "in_progress":
      return "Checking against the source now.";
    case "queued":
      return "Queued to be checked against the source.";
    default:
      return "This solicitation has never been checked against its source.";
  }
}

/**
 * Which findings may be applied without a person, and which may not.
 *
 * Returns both lists rather than filtering, because the caller has to show the
 * second one. A function that silently returned only the safe half would be
 * the silent-overwrite bug wearing a helpful face.
 */
export function partitionFindings(findings: Finding[]): {
  automatic: Finding[];
  needsReview: Finding[];
} {
  const automatic: Finding[] = [];
  const needsReview: Finding[] = [];
  for (const f of findings) {
    if (f.kind === "unchanged") continue;
    const safe =
      f.impact === "safe_metadata" && f.kind === "changed" && !mustBeReviewed(f.subject);
    (safe ? automatic : needsReview).push(f);
  }
  return { automatic, needsReview };
}

export interface DownstreamImpact {
  /** Outreach that must stop until a new packet is approved. */
  stopOutreach: boolean;
  /** Quotes that no longer certainly cover the scope. */
  reconfirmQuotes: boolean;
  /** The assembled package no longer matches the requirements. */
  packageStale: boolean;
  /** The deadline moved earlier and everything downstream of it moves too. */
  deadlineEarlier: boolean;
  lines: string[];
}

/**
 * What the findings cost downstream.
 *
 * Deliberately blunt: a trade-scope change stops outreach, full stop. The
 * subcontractors were asked to price something the solicitation no longer
 * says, and a follow-up chasing that price makes the problem worse.
 *
 * A quote whose scope moved is marked for reconfirmation rather than deleted.
 * Deleting it throws away a number somebody obtained and a conversation
 * somebody had; the honest state is "this needs confirming", not absence.
 */
export function downstreamImpact(findings: Finding[]): DownstreamImpact {
  const material = findings.filter((f) => f.kind !== "unchanged" && f.impact !== "safe_metadata");
  const scopeChanged = material.some((f) => /trade|scope/i.test(f.subject));
  const requirementsChanged = material.some(
    (f) => f.scope === "requirements_and_deadlines" || /form|signature|bond|insurance/i.test(f.subject)
  );
  const deadlineEarlier = material.some(
    (f) => /deadline|due|close/i.test(f.subject) && f.impact === "blocking"
  );
  const documentsChanged = material.some((f) => f.scope === "documents");

  const lines: string[] = [];
  if (deadlineEarlier) {
    lines.push(
      "The deadline moved earlier. Quote due dates and the internal review window move with it, and anything scheduled after the new date is already late."
    );
  }
  if (scopeChanged) {
    lines.push(
      "The trade scope changed, so outreach stops until a new packet is approved. The subcontractors were asked to price work the solicitation no longer describes."
    );
  }
  if (scopeChanged || requirementsChanged) {
    lines.push(
      "Quotes obtained against the old scope are marked as needing reconfirmation. They are kept, not deleted: the number and the conversation behind it are still worth something."
    );
  }
  if (requirementsChanged || documentsChanged) {
    lines.push(
      "The assembled package was built against the previous requirements and no longer matches them."
    );
  }
  if (lines.length === 0) {
    lines.push("Nothing downstream is affected by what this check found.");
  }

  return {
    stopOutreach: scopeChanged,
    reconfirmQuotes: scopeChanged || requirementsChanged,
    packageStale: requirementsChanged || documentsChanged,
    deadlineEarlier,
    lines,
  };
}

/**
 * What must not happen while a check is running.
 *
 * A narrow check blocks narrowly. Rechecking the document list is no reason to
 * hold a call somebody is about to make, and a product that freezes everything
 * during every check teaches people to stop running checks.
 */
export function blockedWhileVerifying(scope: VerificationScope): {
  outreach: boolean;
  calls: boolean;
  submission: boolean;
} {
  if (scope === "full") return { outreach: true, calls: true, submission: true };
  switch (scope) {
    case "requirements_and_deadlines":
    case "trade_scopes":
      // The packet and the call script are both built out of these.
      return { outreach: true, calls: true, submission: true };
    case "documents":
      return { outreach: true, calls: false, submission: true };
    case "bid_readiness":
      return { outreach: false, calls: false, submission: true };
    case "scoring_and_eligibility":
    case "source_and_amendments":
      return { outreach: false, calls: false, submission: false };
    default:
      // An unrecognised scope blocks everything: not knowing what a check
      // touches is not a reason to let a bid go out during it.
      return { outreach: true, calls: true, submission: true };
  }
}

/**
 * The key that stops two full checks running at once.
 *
 * Keyed on the opportunity and the scope rather than on the request, so a
 * double click, a retry and a scheduled run all collapse into one.
 */
export function verificationKey(opportunityId: string, scope: VerificationScope): string {
  return `reverify:${opportunityId}:${scope}`;
}
