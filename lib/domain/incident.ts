/**
 * A provider outage as a thing with a life, not a count of red rows.
 *
 * `assessAutomation` groups today's failed runs by cause and is right to: five
 * agents failing on one exhausted credit balance is one problem with one fix.
 * But it is derived fresh on every request from a rolling window, which means
 * it can only ever answer "what is failing now". It cannot answer the
 * questions an operator asks during a recovery, which are all about time:
 *
 *   When did this start, and what has it cost me since?
 *   The provider is funded now. Did anything actually prove that?
 *   Which of the four hundred failures are still worth retrying?
 *   Did the retry work, or did it just move the failures somewhere else?
 *
 * None of those can be answered by a query over the last six hours. They need
 * a record that outlives the window, which is what an incident is.
 *
 * Pure. The state machine, the eligibility rules and the wording live here;
 * the database and the provider live elsewhere.
 */

/**
 * The lifecycle, in the only order it can happen.
 *
 * `provider_restored` and `test_passed` are deliberately separate. "The card
 * went through" and "a request to the model came back" are different facts,
 * and treating the first as the second is exactly the mistake that puts an
 * account back to work while every job still fails.
 */
export const INCIDENT_STATES = [
  "detected",
  "mitigating",
  "provider_restored",
  "test_passed",
  "backlog_requeued",
  "backlog_draining",
  "recovered",
  "recovery_failed",
] as const;
export type IncidentState = (typeof INCIDENT_STATES)[number];

export const INCIDENT_STATE_LABEL: Record<IncidentState, string> = {
  detected: "Detected",
  mitigating: "Being worked on",
  provider_restored: "Provider account funded, recovery pending verification",
  test_passed: "Test request succeeded",
  backlog_requeued: "Backlog requeued",
  backlog_draining: "Backlog draining",
  recovered: "Recovered",
  recovery_failed: "Recovery failed",
};

/**
 * What an operator should be told to do next, per state.
 *
 * Every one of these is an action, not a reassurance. "We are looking into it"
 * is what a status page says; it is not what somebody with a bid due on Friday
 * needs to read.
 */
export const INCIDENT_NEXT_ACTION: Record<IncidentState, string> = {
  detected: "Confirm the cause, then fix it at the provider.",
  mitigating: "Finish the fix at the provider, then run the recovery check.",
  provider_restored:
    "Run the recovery check. Funding the account is not proof that requests work again.",
  test_passed: "Requeue the work that failed during the outage.",
  backlog_requeued: "Wait for the queue to drain, then confirm the work landed.",
  backlog_draining: "Wait for the queue to drain, then confirm the work landed.",
  recovered: "Nothing. Confirmed working end to end.",
  recovery_failed: "Read the failure below and fix the underlying cause before retrying.",
};

/**
 * Legal moves.
 *
 * Nothing reaches `recovered` except from `backlog_draining`, and nothing
 * reaches `backlog_draining` except through a passed test. That is the whole
 * point of the machine: an incident cannot be declared over by anybody's
 * optimism, only by work that ran.
 */
const TRANSITIONS: Record<IncidentState, IncidentState[]> = {
  detected: ["mitigating", "provider_restored", "recovery_failed"],
  mitigating: ["provider_restored", "recovery_failed"],
  provider_restored: ["test_passed", "recovery_failed"],
  test_passed: ["backlog_requeued", "recovered", "recovery_failed"],
  backlog_requeued: ["backlog_draining", "recovery_failed"],
  backlog_draining: ["recovered", "recovery_failed"],
  // A recovery that failed can be worked again. An incident that recovered is
  // finished: a later outage is a new incident, because merging them would
  // lose the fact that the first one was fixed.
  recovered: [],
  recovery_failed: ["mitigating", "provider_restored"],
};

export function canTransition(from: IncidentState, to: IncidentState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isOpen(state: IncidentState): boolean {
  return state !== "recovered";
}

export function parseIncidentState(v: unknown): IncidentState {
  const s = String(v ?? "").toLowerCase().trim();
  // Anything unrecognised is still open and still needs a person. Reading an
  // unknown value as "recovered" would close an incident nobody fixed.
  return (INCIDENT_STATES as readonly string[]).includes(s) ? (s as IncidentState) : "detected";
}

export type IncidentSeverity = "blocking" | "degrading";

export interface JobFailure {
  /** The job_runs row. */
  id: string;
  agent: string;
  /** The record the job was about, when it named one. */
  opportunityId: string | null;
  failedAt: Date;
  error: string | null;
}

/**
 * Facts about a failed job that decide whether replaying it is safe.
 *
 * Gathered separately from the failure itself, because every one of them is a
 * question about the world now rather than about the failure then.
 */
export interface ReplayContext {
  /** The named record no longer exists. */
  recordMissing?: boolean;
  /** The operator stopped this pursuit. */
  pursuitStopped?: boolean;
  /** The solicitation's deadline has passed. */
  deadlinePassed?: boolean;
  /** A later run of the same agent on the same record already succeeded. */
  supersededBySuccess?: boolean;
  /** Somebody has already fixed this by hand. */
  manuallyResolved?: boolean;
  /** Already requeued by an earlier recovery attempt. */
  alreadyRequeued?: boolean;
}

export type IneligibleReason =
  | "record_gone"
  | "pursuit_stopped"
  | "deadline_passed"
  | "superseded"
  | "manually_resolved"
  | "already_requeued"
  | "unsafe_to_replay"
  | "different_cause";

export const INELIGIBLE_LABEL: Record<IneligibleReason, string> = {
  record_gone: "the record it was about no longer exists",
  pursuit_stopped: "this pursuit has been stopped",
  deadline_passed: "the deadline has already passed",
  superseded: "a later run already did this work",
  manually_resolved: "somebody has already handled it",
  already_requeued: "it was requeued by an earlier recovery",
  unsafe_to_replay: "replaying it could send something twice",
  different_cause: "it failed for a different reason, so this recovery would not fix it",
};

/**
 * Agents whose work reaches somebody outside this system.
 *
 * Replaying a scoring run costs a few cents. Replaying an outreach send puts a
 * second email in a subcontractor's inbox, and no amount of "it failed the
 * first time" makes that safe, because the failure could have been AFTER the
 * message left. These are never replayed in bulk; the operator sends them
 * again one at a time, having looked.
 */
const OUTWARD_FACING = new Set([
  "outreach",
  "outreach-followup",
  "outreach-recovery-sweep",
  "sources-sought-responder",
  "backlink-outreach-sweep",
  "sub-onboarding",
]);

export interface ReplayDecision {
  failure: JobFailure;
  eligible: boolean;
  reason: IneligibleReason | null;
}

/**
 * Should this failure be replayed as part of this incident's recovery?
 *
 * The instruction is not to blindly replay every historical failure, and every
 * clause below is a way that would go wrong. The order matters: the most
 * conclusive facts are checked first, so an operator reading "the deadline has
 * already passed" is not left wondering whether it was also superseded.
 */
export function replayDecision(
  failure: JobFailure,
  cause: string,
  context: ReplayContext = {}
): ReplayDecision {
  const no = (reason: IneligibleReason): ReplayDecision => ({ failure, eligible: false, reason });

  if (context.alreadyRequeued) return no("already_requeued");
  if (context.recordMissing) return no("record_gone");
  if (context.pursuitStopped) return no("pursuit_stopped");
  if (context.deadlinePassed) return no("deadline_passed");
  if (context.supersededBySuccess) return no("superseded");
  if (context.manuallyResolved) return no("manually_resolved");
  if (OUTWARD_FACING.has(failure.agent)) return no("unsafe_to_replay");
  /*
   * A recovery fixes one cause. A job that failed on a bad API key during a
   * credit outage will fail again on the bad API key, and requeueing it makes
   * the backlog look like it is not draining when it is.
   */
  if (classifyForRecovery(failure.error) !== cause) return no("different_cause");
  return { failure, eligible: true, reason: null };
}

/**
 * The cause a failure would be filed under.
 *
 * Deliberately coarse, and deliberately a separate function from the display
 * classifier: this one decides whether two failures are the same problem for
 * the purpose of replaying them together, which is a lower bar than deciding
 * what to tell somebody.
 */
export function classifyForRecovery(error: string | null | undefined): string {
  const e = (error ?? "").toLowerCase();
  if (/credit|billing|payment|insufficient|quota|balance/.test(e)) return "provider_credit";
  if (/rate.?limit|429|overloaded|529/.test(e)) return "provider_rate_limit";
  if (/401|403|unauthor|invalid.*key|authentication/.test(e)) return "provider_auth";
  if (/timeout|econnreset|enotfound|network|socket/.test(e)) return "network";
  if (/5\d\d|internal server/.test(e)) return "provider_error";
  return "other";
}

export interface ReplayPlan {
  eligible: JobFailure[];
  skipped: { failure: JobFailure; reason: IneligibleReason }[];
  /** Counts by reason, so the UI can say why without listing four hundred rows. */
  skippedByReason: Record<string, number>;
  total: number;
}

export function planReplay(
  decisions: readonly ReplayDecision[]
): ReplayPlan {
  const eligible = decisions.filter((d) => d.eligible).map((d) => d.failure);
  const skipped = decisions
    .filter((d) => !d.eligible && d.reason)
    .map((d) => ({ failure: d.failure, reason: d.reason as IneligibleReason }));
  const skippedByReason: Record<string, number> = {};
  for (const s of skipped) {
    skippedByReason[s.reason] = (skippedByReason[s.reason] ?? 0) + 1;
  }
  return { eligible, skipped, skippedByReason, total: decisions.length };
}

/**
 * One sentence saying what a recovery would do, before it does it.
 *
 * Written for somebody deciding whether to press the button. "412 failures"
 * is not that; "38 will run again, 374 will not, and here is why" is.
 */
export function describePlan(plan: ReplayPlan): string {
  if (plan.total === 0) return "No failures from this incident are left to retry.";
  const parts = [`${plan.eligible.length} of ${plan.total} will run again`];
  const reasons = Object.entries(plan.skippedByReason)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => `${n} because ${INELIGIBLE_LABEL[reason as IneligibleReason]}`);
  if (reasons.length > 0) parts.push(`the rest will not: ${reasons.join(", ")}`);
  return `${parts.join("; ")}.`;
}

/**
 * The idempotency key for one replayed job.
 *
 * Keyed on the incident as well as the job, so a second press of the recovery
 * button cannot queue the same work twice, and so a genuinely new incident
 * later can replay the same job again. Both halves matter: without the
 * incident the second outage could never be recovered, and without the job the
 * whole recovery would collapse into one key.
 */
export function replayKey(incidentId: string, failure: JobFailure): string {
  return `recovery:${incidentId}:${failure.id}`;
}
