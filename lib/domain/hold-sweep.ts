/**
 * Release holds whose calls can no longer be on the wire.
 *
 * Nothing in this file calls a provider or sends mail. A work receipt or a
 * queued mail claim that outlived its lease is handed back to its normal
 * schedule, which runs the work again under a fresh claim; an attempt that
 * may have reached the mailbox is left for the Sent-folder reconciliation in
 * the agent layer. The price reservation on an abandoned usage row is left
 * in place.
 */
import { query } from "../db";
import { settleAbandonedUsage } from "../api-usage/ledger";
import {
  AI_RECEIPT_TTL_MS,
  JOB_RUN_CEILING_MS,
  MAIL_CLAIM_TTL_MS,
  PROVIDER_ATTEMPT_TTL_MS,
  PROVIDER_JOB_AGENTS,
  USAGE_ABANDON_MINUTES,
} from "./hold-registry";

export const QUEUED_MAIL_RELEASE_DETAIL =
  "The scheduled send never reached the mailbox before its lease expired. Nothing was sent; the next outreach run may send it.";

const ATTEMPT_FAILURE =
  "A provider attempt stayed unresolved past the request timeout and its safety margin. " +
  "The account hold was released and the call was not replayed. " +
  "Reconcile that attempt before treating its work as finished.";

const COUPLED_RUN_ERROR =
  "Interrupted: this run was still open after its provider attempt was released. The attempt was not replayed.";

const CEILING_RUN_ERROR =
  "Interrupted: this run outlived the 90 minute job ceiling. It was not replayed.";

export interface ReclaimedAttempt {
  provider: string;
  accountScope: string;
  pendingStartedAt: string;
}

export interface HoldSweepResult {
  reclaimedAttempts: ReclaimedAttempt[];
  settledUsage: number;
  releasedRfqClaims: number;
  closedRuns: number;
  settledDispatchClaims: number;
  heldPreviews: number;
  settledManualQueued: number;
  settledManualUncertain: number;
  /** Receipts past their lease, handed back to the schedule. */
  releasedReceipts: number;
  /** Receipts still inside their lease: a call may be in flight. */
  pendingReceiptsLeft: number;
  /** Scheduled sends that never reached the mailbox, now held for a retry. */
  releasedQueuedMail: number;
  /** Attempting or unknown scheduled sends past their lease, awaiting Sent-folder reconciliation. */
  unresolvedScheduledMail: number;
  expiredReverifications: number;
  /** Set by the agent layer after it reads the mailbox. */
  confirmedSentMail?: number;
  releasedUncertainMail?: number;
}

export async function reclaimStaleProviderAttempts(): Promise<HoldSweepResult> {
  const result = emptyResult();
  const reclaimed = await query<{
    provider: string;
    account_scope: string;
    pending_started_at: Date;
    closed_runs: number;
  }>(
    `with due as (
       select account_scope, provider, credential_hash, pending_started_at
         from ai_provider_facts
        where pending_attempt is not null
          and pending_started_at <= clock_timestamp() - ($2::bigint * interval '1 millisecond')
     ),
     reclaimed as (
       update ai_provider_facts as facts
          set pending_attempt = null,
              pending_started_at = null,
              last_failure_at = clock_timestamp(),
              failure_reason = $1,
              failure_status = null
         from due
        where facts.account_scope = due.account_scope
          and facts.provider = due.provider
          and facts.credential_hash = due.credential_hash
          and facts.pending_attempt is not null
        returning due.provider, due.account_scope, due.pending_started_at, due.credential_hash
     ),
     closed as (
       update job_runs
          set status = 'error',
              finished_at = clock_timestamp(),
              error = $3
        where id in (
          select distinct on (reclaimed.account_scope, reclaimed.provider, reclaimed.credential_hash)
                 runs.id
            from reclaimed
            join job_runs as runs
              on runs.status = 'running'
             and runs.agent = any($4::text[])
             and runs.org_id = case
                   when split_part(reclaimed.account_scope, ':', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                   then split_part(reclaimed.account_scope, ':', 2)::uuid
                   else null
                 end
             and runs.started_at <= reclaimed.pending_started_at
             and runs.started_at > reclaimed.pending_started_at - ($2::bigint * interval '1 millisecond')
           order by reclaimed.account_scope, reclaimed.provider, reclaimed.credential_hash, runs.started_at desc
        )
        returning id
     )
     select provider, account_scope, pending_started_at,
            (select count(*)::int from closed) as closed_runs
       from reclaimed`,
    [ATTEMPT_FAILURE, PROVIDER_ATTEMPT_TTL_MS, COUPLED_RUN_ERROR, [...PROVIDER_JOB_AGENTS]]
  );
  result.reclaimedAttempts = reclaimed.map((row) => ({
    provider: row.provider,
    accountScope: row.account_scope,
    pendingStartedAt: new Date(row.pending_started_at).toISOString(),
  }));
  result.closedRuns += Number(reclaimed[0]?.closed_runs ?? 0);

  const ceiling = await query<{ id: string }>(
    `update job_runs
        set status = 'error',
            finished_at = clock_timestamp(),
            error = $2
      where status = 'running'
        and started_at <= clock_timestamp() - ($1::bigint * interval '1 millisecond')
      returning id`,
    [JOB_RUN_CEILING_MS, CEILING_RUN_ERROR]
  );
  result.closedRuns += ceiling.length;

  result.settledUsage = await settleAbandonedUsage(USAGE_ABANDON_MINUTES);

  const rfq = await query<{ id: string }>(
    `update rfq_send_claims
        set state = 'released'
      where state = 'reserved'
        and created_at <= clock_timestamp() - ($1::bigint * interval '1 millisecond')
      returning id`,
    [PROVIDER_ATTEMPT_TTL_MS]
  );
  result.releasedRfqClaims = rfq.length;

  const dispatch = await query<{ id: string }>(
    `update prospective_dispatch_claims
        set finished_at = clock_timestamp()
      where finished_at is null
        and started_at <= clock_timestamp() - ($1::bigint * interval '1 millisecond')
      returning id`,
    [PROVIDER_ATTEMPT_TTL_MS]
  );
  result.settledDispatchClaims = dispatch.length;

  const previews = await query<{ id: string }>(
    `update prospective_previews
        set state = 'held',
            finished_at = coalesce(finished_at, clock_timestamp())
      where state = 'running'
        and (
          (running_since is not null and running_since <= clock_timestamp() - ($1::bigint * interval '1 millisecond'))
          or (running_since is null and created_at <= clock_timestamp() - ($1::bigint * interval '1 millisecond'))
        )
      returning id`,
    [PROVIDER_ATTEMPT_TTL_MS]
  );
  result.heldPreviews = previews.length;

  const reverifications = await query<{ id: string }>(
    `update solicitation_verifications
        set state = 'failed',
            finished_at = clock_timestamp(),
            error = $2
      where state = 'in_progress'
        and started_at <= clock_timestamp() - ($1::bigint * interval '1 millisecond')
      returning id`,
    [
      PROVIDER_ATTEMPT_TTL_MS,
      "The check stayed in progress past its 15 minute lease. It was not replayed.",
    ]
  );
  result.expiredReverifications = reverifications.length;

  const queued = await query<{ id: string }>(
    `update communications
        set delivery_state = 'held',
            delivery_detail = 'The manual send never reached the mailbox. It was left for an operator and was not retried.',
            delivery_updated_at = clock_timestamp()
      where delivery_state = 'queued'
        and request_key is not null
        and coalesce(meta->>'kind', '') = 'manual'
        and created_at <= clock_timestamp() - ($1::bigint * interval '1 millisecond')
      returning id`,
    [MAIL_CLAIM_TTL_MS]
  );
  result.settledManualQueued = queued.length;

  const attempting = await query<{ id: string }>(
    `update communications
        set delivery_state = 'unknown',
            delivery_detail = 'The manual send was attempting when its lease expired. Check Gmail Sent. It was not retried.',
            delivery_updated_at = clock_timestamp()
      where delivery_state = 'attempting'
        and request_key is not null
        and coalesce(meta->>'kind', '') = 'manual'
        and coalesce(provider_attempted_at, created_at) <= clock_timestamp() - ($1::bigint * interval '1 millisecond')
      returning id`,
    [MAIL_CLAIM_TTL_MS]
  );
  result.settledManualUncertain = attempting.length;

  // Admission expires these too, one organization at a time, when work for
  // that organization next arrives. The sweep does it for every organization
  // so a tenant with nothing else queued is not left with a stale lease.
  const receipts = await query<{ id: string }>(
    `update ai_work_receipts
        set state = 'retryable'
      where state = 'pending'
        and started_at <= clock_timestamp() - ($1::bigint * interval '1 millisecond')
      returning work_key as id`,
    [AI_RECEIPT_TTL_MS]
  );
  result.releasedReceipts = receipts.length;
  const live = await query<{ n: number }>(
    `select count(*)::int as n from ai_work_receipts where state = 'pending'`
  );
  result.pendingReceiptsLeft = Number(live[0]?.n ?? 0);

  // A queued scheduled send has no provider_attempted_at: the mailbox was
  // never asked. Nothing can have left, so the claim goes back to held, the
  // one state the normal send path may claim again.
  const queuedMail = await query<{ id: string }>(
    `update communications
        set delivery_state = 'held',
            delivery_detail = $2,
            delivery_updated_at = clock_timestamp()
      where delivery_state = 'queued'
        and request_key is not null
        and provider_attempted_at is null
        and coalesce(meta->>'kind', '') <> 'manual'
        and created_at <= clock_timestamp() - ($1::bigint * interval '1 millisecond')
      returning id`,
    [MAIL_CLAIM_TTL_MS, QUEUED_MAIL_RELEASE_DETAIL]
  );
  result.releasedQueuedMail = queuedMail.length;
  result.unresolvedScheduledMail = await countUnresolvedScheduledMail();

  if (result.reclaimedAttempts.length > 0) {
    console.warn(
      `[hold-sweep] released ${result.reclaimedAttempts.length} stale provider attempt(s) without replay`
    );
  }
  return result;
}

/**
 * Scheduled sends whose outcome is still unknown after their lease: the
 * mailbox may or may not have accepted them. These are what the Sent-folder
 * reconciliation works through, and what the operator alert counts when the
 * mailbox cannot be read.
 */
export async function countUnresolvedScheduledMail(): Promise<number> {
  const mail = await query<{ n: number }>(
    `select count(*)::int as n from communications
      where request_key is not null
        and delivery_state in ('queued', 'attempting', 'unknown')
        and coalesce(meta->>'kind', '') <> 'manual'
        and coalesce(provider_attempted_at, created_at) <= clock_timestamp() - ($1::bigint * interval '1 millisecond')`,
    [MAIL_CLAIM_TTL_MS]
  );
  return Number(mail[0]?.n ?? 0);
}

function emptyResult(): HoldSweepResult {
  return {
    reclaimedAttempts: [],
    settledUsage: 0,
    releasedRfqClaims: 0,
    closedRuns: 0,
    settledDispatchClaims: 0,
    heldPreviews: 0,
    settledManualQueued: 0,
    settledManualUncertain: 0,
    releasedReceipts: 0,
    pendingReceiptsLeft: 0,
    releasedQueuedMail: 0,
    unresolvedScheduledMail: 0,
    expiredReverifications: 0,
  };
}

export function sweepMail(result: HoldSweepResult): { subject: string; text: string } {
  const lines = [
    "The hold sweep released work that had outlived its lease. Nothing here was replayed by the sweep itself; work handed back to its schedule runs again under a fresh claim.",
  ];
  if (result.reclaimedAttempts.length > 0) {
    const names = result.reclaimedAttempts.map((row) => row.provider).join(", ");
    lines.push(`Provider attempts released: ${result.reclaimedAttempts.length} (${names}).`);
  }
  if (result.settledUsage > 0) {
    lines.push(
      `Usage rows marked abandoned: ${result.settledUsage}. Their price reservation was kept for review.`
    );
  }
  if (result.closedRuns > 0) lines.push(`Job runs closed: ${result.closedRuns}. They were not queued again.`);
  if (result.releasedRfqClaims > 0) {
    lines.push(`Quote-request slots released: ${result.releasedRfqClaims}. No message was sent.`);
  }
  if (result.settledDispatchClaims > 0) {
    lines.push(`Preview dispatch claims finished: ${result.settledDispatchClaims}. The callback was not run.`);
  }
  if (result.heldPreviews > 0) lines.push(`Preview runs marked held: ${result.heldPreviews}.`);
  if (result.settledManualQueued > 0) {
    lines.push(`Manual sends that never reached the mailbox, now held: ${result.settledManualQueued}.`);
  }
  if (result.settledManualUncertain > 0) {
    lines.push(`Manual sends left unknown for Gmail review: ${result.settledManualUncertain}.`);
  }
  if (result.expiredReverifications > 0) {
    lines.push(
      `Reverification checks marked failed after their lease: ${result.expiredReverifications}. They were not replayed.`
    );
  }
  if (result.releasedReceipts > 0) {
    lines.push(
      `AI work receipts past their 25 minute lease, handed back to the schedule: ${result.releasedReceipts}. The next scheduled run retries that work once.`
    );
  }
  if (result.pendingReceiptsLeft > 0) {
    lines.push(
      `AI work receipts still inside their lease: ${result.pendingReceiptsLeft}. A call may be in flight.`
    );
  }
  if (result.releasedQueuedMail > 0) {
    lines.push(
      `Scheduled sends that never reached the mailbox, now held for the next outreach run: ${result.releasedQueuedMail}.`
    );
  }
  if ((result.confirmedSentMail ?? 0) > 0) {
    lines.push(
      `Uncertain sends found in the mailbox's Sent folder and recorded as sent: ${result.confirmedSentMail}.`
    );
  }
  if ((result.releasedUncertainMail ?? 0) > 0) {
    lines.push(
      `Uncertain sends not found in Sent after their lease, now held for the next outreach run: ${result.releasedUncertainMail}.`
    );
  }
  if (result.unresolvedScheduledMail > 0) {
    lines.push(
      `Scheduled sends still unresolved because the mailbox could not be read: ${result.unresolvedScheduledMail}. They are retried on the next sweep.`
    );
  }
  return { subject: "BrostCo released a stuck hold", text: lines.join("\n") };
}
