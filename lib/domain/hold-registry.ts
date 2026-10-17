/**
 * Every durable latch in BrostCo, and how long it may be held.
 *
 * A timer must not overlap a request the provider may already be billing.
 * The AI clients abort one call at AI_CALL_TIMEOUT_MS and do not retry it
 * (Anthropic maxRetries 0, OpenAI one abort timer). The hold TTL is that
 * hard timeout plus HOLD_MARGIN_MS, so when a lease expires the call cannot
 * still be on the wire. Expiry releases the account. It does not replay the
 * call. Work receipts and scheduled-mail claims stay unresolved on purpose:
 * replaying those is how a dead process gets billed twice.
 */

export const AI_CALL_TIMEOUT_MS = 600_000;
export const HOLD_MARGIN_MS = 5 * 60_000;
/** 15 minutes. Longer than the 10 minute provider abort. */
export const PROVIDER_ATTEMPT_TTL_MS = AI_CALL_TIMEOUT_MS + HOLD_MARGIN_MS;
/** Same bound as the attempt TTL, in minutes, for the usage ledger. */
export const USAGE_ABANDON_MINUTES = PROVIDER_ATTEMPT_TTL_MS / 60_000;
/**
 * A job may download documents and then make one bounded AI call. 90 minutes
 * is past that budget. The audit row is closed. The call is not replayed.
 */
export const JOB_RUN_CEILING_MS = 90 * 60_000;
/** Gmail's client timeout is 15 seconds. This lease is the provider TTL. */
export const MAIL_CLAIM_TTL_MS = PROVIDER_ATTEMPT_TTL_MS;

export const PROVIDER_JOB_AGENTS = [
  "scoring-engine",
  "solicitation-analyst",
  "sources-sought-responder",
  "bid-builder",
  "call-prep",
  "compliance-auditor",
  "compliance-monitor",
  "learning-loop",
] as const;

export interface HoldRecord {
  name: string;
  where: string;
  currentExpiry: string;
  ttl: string;
  releasePath: string;
  /** What expiry is allowed to do with the original call. */
  replay: "never" | "idempotent-new-work" | "not-applicable";
}

export const HOLD_REGISTRY: readonly HoldRecord[] = [
  {
    name: "AI provider attempt",
    where: "ai_provider_facts.pending_attempt / pending_started_at",
    currentExpiry: "none; a crash or an uncertain settlement kept the token forever",
    ttl: "15 min (10 min hard abort + 5 min margin)",
    releasePath: "hold sweep nulls the token and records a failure. The recovery probe also runs the sweep before it reads holds.",
    replay: "never",
  },
  {
    name: "Provider refusal",
    where: "ai_provider_facts.refusal_reason",
    currentExpiry: "until a health probe answers",
    ttl: "probe lease next_probe_at, backing off 10 min, 30 min, 1 h, then 6 h",
    releasePath: "a successful probeProviderRecovery call. The sweep does not clear a credit or quota refusal.",
    replay: "not-applicable",
  },
  {
    name: "Provider failure cooldown",
    where: "ai_provider_facts.failure_reason",
    currentExpiry: "the Retry-After timestamp embedded in the reason, when one was recorded",
    ttl: "that timestamp; a reason with no timestamp does not block admission",
    releasePath: "admission allows a new call once the timestamp has passed. A later success clears the reason.",
    replay: "not-applicable",
  },
  {
    name: "AI work receipt",
    where: "ai_work_receipts.state = pending",
    currentExpiry: "none; pending means the same work must not be replayed",
    ttl: "no transition to retryable. The receipt outlives the provider timeout on purpose.",
    releasePath: "only a confirmed completion, or a definite local refusal that marks the row retryable. The sweep counts stale receipts and leaves them pending.",
    replay: "never",
  },
  {
    name: "Usage ledger row",
    where: "api_usage_events.outcome = pending",
    currentExpiry: "120 min via settleAbandonedUsage",
    ttl: "15 min, the same bound as a provider attempt",
    releasePath: "settleAbandonedUsage marks the row failed and keeps its price reservation. Nothing is billed again and the ceiling is no longer held open.",
    replay: "never",
  },
  {
    name: "Usage billing lease",
    where: "api_usage_job_leases.expires_at",
    currentExpiry: "1 hour, already a lease",
    ttl: "1 hour",
    releasePath: "the next billing tick takes the lease when expires_at has passed.",
    replay: "not-applicable",
  },
  {
    name: "Job run",
    where: "job_runs.status = running",
    currentExpiry: "60 min and only if the run started before this process booted",
    ttl: "15 min when the run was the holder of a released provider attempt; otherwise 90 min",
    releasePath: "the sweep sets status error and does not enqueue the job again. closeInterruptedRuns still closes runs orphaned by a restart.",
    replay: "never",
  },
  {
    name: "Quote-request slot",
    where: "rfq_send_claims.state = reserved",
    currentExpiry: "the rest of the UTC day; the daily count ignores older days",
    ttl: "15 min",
    releasePath: "outreach releases the claim in a finally when the send does not settle. The sweep releases a claim still reserved after the TTL and does not send mail.",
    replay: "never",
  },
  {
    name: "Follow-up lease",
    where: "communications.follow_up_at",
    currentExpiry: "15 min claim, then 6 h if the address is unverified",
    ttl: "15 min",
    releasePath: "the timestamp moves forward on claim, so a dead worker becomes eligible again when it passes.",
    replay: "idempotent-new-work",
  },
  {
    name: "Manual email claim",
    where: "communications.delivery_state queued or attempting, meta.kind = manual",
    currentExpiry: "none",
    ttl: "15 min",
    releasePath: "queued becomes held, attempting becomes unknown. Neither state is sent by the sweep. A person can compose a new manual message only from held.",
    replay: "never",
  },
  {
    name: "Scheduled email claim",
    where: "communications.delivery_state queued, attempting, or unknown for a scheduled request",
    currentExpiry: "none, and a retry of those states is refused",
    ttl: "no automatic release. The row is the lease and it outlives the SMTP timeout so the message cannot be sent twice.",
    releasePath: "operator review of the communication and Gmail Sent. The sweep reports the count and does not change the row.",
    replay: "never",
  },
  {
    name: "Prospective dispatch claim",
    where: "prospective_dispatch_claims.finished_at is null",
    currentExpiry: "none",
    ttl: "15 min",
    releasePath: "a certain result finishes the claim in a finally. The sweep sets finished_at after the TTL and does not run the callback again.",
    replay: "never",
  },
  {
    name: "Prospective preview",
    where: "prospective_previews.state = running",
    currentExpiry: "none if the process dies after the running write",
    ttl: "15 min from running_since",
    releasePath: "the existing catch marks the preview held. The sweep does the same after the TTL and does not call the model.",
    replay: "never",
  },
  {
    name: "Prospective fence",
    where: "prospective_fence.released_at is null",
    currentExpiry: "until an operator releases it with the rollout reference",
    ttl: "no age expiry. Time does not prove the preview finished.",
    releasePath: "releasePreview, and only when no dispatch is still inside its TTL.",
    replay: "not-applicable",
  },
  {
    name: "Advisory transaction lock",
    where: "pg_try_advisory_xact_lock in provider admission, receipts, and the preview gate",
    currentExpiry: "end of the transaction",
    ttl: "the transaction",
    releasePath: "commit or rollback. The lock is not held across the provider call.",
    replay: "not-applicable",
  },
  {
    name: "Queue singleton",
    where: "pg-boss singletonKey / singletonSeconds",
    currentExpiry: "the singleton window supplied with the job, usually 1 hour",
    ttl: "that window",
    releasePath: "pg-boss drops a duplicate send inside the window. A later send is a new job, and a pending work receipt still refuses a billed replay.",
    replay: "idempotent-new-work",
  },
  {
    name: "Review window",
    where: "opportunities.review_expires_at",
    currentExpiry: "the timestamp written when the item entered review",
    ttl: "that timestamp",
    releasePath: "the review-expiry sweep passes or keeps the item. It does not call a provider.",
    replay: "not-applicable",
  },
  {
    name: "Automation incident",
    where: "automation_incidents.state other than recovered",
    currentExpiry: "until the lifecycle reaches recovered",
    ttl: "no age expiry. An incident that aged out would hide an outage.",
    releasePath: "advance() through the incident lifecycle. Alerts are deduped with start_alert_at and end_alert_at.",
    replay: "not-applicable",
  },
];

export function providerAttemptIsStale(
  pendingStartedAt: Date | string | null | undefined,
  now = Date.now()
): boolean {
  if (pendingStartedAt == null) return false;
  const started = new Date(pendingStartedAt).getTime();
  return Number.isFinite(started) && now - started >= PROVIDER_ATTEMPT_TTL_MS;
}

export function sweepActed(result: {
  reclaimedAttempts: unknown[];
  settledUsage: number;
  releasedRfqClaims: number;
  closedRuns: number;
  settledDispatchClaims: number;
  heldPreviews: number;
  settledManualQueued: number;
  settledManualUncertain: number;
}): boolean {
  return (
    result.reclaimedAttempts.length +
      result.settledUsage +
      result.releasedRfqClaims +
      result.closedRuns +
      result.settledDispatchClaims +
      result.heldPreviews +
      result.settledManualQueued +
      result.settledManualUncertain >
    0
  );
}

/** One alert while a condition is true, and one when it clears. */
export function latchAlertDecision(
  active: number,
  incidentOpen: boolean
): "alert" | "resolve" | "quiet" {
  if (active > 0) return incidentOpen ? "quiet" : "alert";
  return incidentOpen ? "resolve" : "quiet";
}
