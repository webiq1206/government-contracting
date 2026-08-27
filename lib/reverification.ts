/**
 * Storing what a re-check found, and refusing to start two of the same one.
 *
 * The snapshot is taken before any check runs, and that ordering is the whole
 * reason this file has a `start` separate from a `finish`. A comparison needs
 * something to compare against, and reconstructing "what the record said
 * before" out of a record that has since been updated is guesswork dressed as
 * evidence.
 */
import { createHash } from "node:crypto";
import { query, queryOne } from "./db";
import {
  outcomeState,
  parseVerificationState,
  verificationKey,
  type Coverage,
  type Finding,
  type VerificationScope,
  type VerificationState,
} from "./domain/reverification";

export interface VerificationRun {
  id: string;
  opportunityId: string;
  scope: VerificationScope;
  state: VerificationState;
  requestedBy: string;
  queuedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  fingerprintBefore: string | null;
  fingerprintAfter: string | null;
  coverage: Coverage | null;
  findings: Finding[];
  failedScopes: VerificationScope[];
  error: string | null;
  acceptedAt: Date | null;
  acceptedBy: string | null;
}

interface Row {
  id: string;
  opportunity_id: string;
  scope: string;
  state: string;
  requested_by: string;
  queued_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  fingerprint_before: string | null;
  fingerprint_after: string | null;
  documents_expected: number | null;
  documents_verified: number | null;
  documents_unreadable: number | null;
  pages_processed: number | null;
  findings: unknown;
  failed_scopes: string[] | null;
  error: string | null;
  accepted_at: Date | null;
  accepted_by: string | null;
}

function toRun(r: Row): VerificationRun {
  /*
   * Coverage is null when the run never got as far as counting.
   *
   * Deliberately not zeroed: a run that failed before opening anything has
   * not established that there are no documents, and a screen reading "0 of 0
   * documents, verified" would be the exact lie this table exists to stop.
   */
  const coverage =
    r.documents_expected == null && r.documents_verified == null && r.pages_processed == null
      ? null
      : {
          documentsExpected: r.documents_expected ?? 0,
          documentsVerified: r.documents_verified ?? 0,
          documentsUnreadable: r.documents_unreadable ?? 0,
          pagesProcessed: r.pages_processed ?? 0,
        };
  return {
    id: r.id,
    opportunityId: r.opportunity_id,
    scope: r.scope as VerificationScope,
    state: parseVerificationState(r.state),
    requestedBy: r.requested_by,
    queuedAt: r.queued_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    fingerprintBefore: r.fingerprint_before,
    fingerprintAfter: r.fingerprint_after,
    coverage,
    findings: Array.isArray(r.findings) ? (r.findings as Finding[]) : [],
    failedScopes: (r.failed_scopes ?? []) as VerificationScope[],
    error: r.error,
    acceptedAt: r.accepted_at,
    acceptedBy: r.accepted_by,
  };
}

const SELECT = `
  select id, opportunity_id, scope, state, requested_by, queued_at, started_at,
         finished_at, fingerprint_before, fingerprint_after, documents_expected,
         documents_verified, documents_unreadable, pages_processed, findings,
         failed_scopes, error, accepted_at, accepted_by
    from solicitation_verifications
`;

export class VerificationRejected extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "VerificationRejected";
  }
}

/** A stable hash of whatever the caller considers the record's inputs. */
export function fingerprint(record: unknown): string {
  return createHash("sha256").update(canonical(record)).digest("hex").slice(0, 32);
}

function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const entries = Object.entries(v as Record<string, unknown>)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, value]) => `${JSON.stringify(k)}:${canonical(value)}`).join(",")}}`;
}

/**
 * Queue a run, or hand back the one already going.
 *
 * The partial unique index does the work rather than a read-then-write,
 * because a double click and a scheduled run landing in the same second is
 * exactly the case a read-then-write loses. A caller that gets back a run it
 * did not start is told so, so it can show progress instead of claiming to
 * have begun something.
 */
export async function startVerification(input: {
  orgId: string;
  opportunityId: string;
  scope: VerificationScope;
  requestedBy: string;
  /** The record as it stands, stored before anything is checked. */
  snapshot: Record<string, unknown>;
}): Promise<{ run: VerificationRun; alreadyRunning: boolean }> {
  const owned = await queryOne<{ id: string }>(
    `select id from opportunities where id = $1 and org_id = $2`,
    [input.opportunityId, input.orgId]
  );
  if (!owned) throw new VerificationRejected("That opportunity is not on this account.");

  const key = verificationKey(input.opportunityId, input.scope);
  const inserted = await queryOne<Row>(
    `insert into solicitation_verifications
       (org_id, opportunity_id, scope, state, requested_by, snapshot,
        fingerprint_before, idempotency_key)
     values ($1,$2,$3,'queued',$4,$5::jsonb,$6,$7)
     on conflict (idempotency_key) where state in ('queued','in_progress')
     do nothing
     returning id, opportunity_id, scope, state, requested_by, queued_at, started_at,
               finished_at, fingerprint_before, fingerprint_after, documents_expected,
               documents_verified, documents_unreadable, pages_processed, findings,
               failed_scopes, error, accepted_at, accepted_by`,
    [
      input.orgId,
      input.opportunityId,
      input.scope,
      input.requestedBy,
      JSON.stringify(input.snapshot),
      fingerprint(input.snapshot),
      key,
    ]
  );
  if (inserted) return { run: toRun(inserted), alreadyRunning: false };

  const live = await queryOne<Row>(
    `${SELECT} where idempotency_key = $1 and state in ('queued','in_progress') limit 1`,
    [key]
  );
  if (!live) throw new VerificationRejected("The check could not be queued. Try again.");
  return { run: toRun(live), alreadyRunning: true };
}

/** Mark a queued run as running. */
export async function markRunning(runId: string, orgId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `update solicitation_verifications
        set state = 'in_progress', started_at = coalesce(started_at, now())
      where id = $1 and org_id = $2 and state = 'queued'
      returning id`,
    [runId, orgId]
  );
  return rows.length > 0;
}

/**
 * Record what the run established.
 *
 * The state is computed from the findings and the coverage rather than passed
 * in. A caller that could name its own outcome could name "verified" for a run
 * that read four of nine documents, which is the one conclusion this whole
 * work package exists to make impossible.
 */
export async function finishVerification(input: {
  runId: string;
  orgId: string;
  findings: Finding[];
  coverage: Coverage;
  failedScopes: VerificationScope[];
  fingerprintAfter: string | null;
  aborted?: boolean;
  error?: string | null;
}): Promise<VerificationRun> {
  const state = outcomeState({
    findings: input.findings,
    coverage: input.coverage,
    aborted: input.aborted === true,
    failedScopes: input.failedScopes,
  });
  const row = await queryOne<Row>(
    `update solicitation_verifications
        set state = $3,
            finished_at = now(),
            findings = $4::jsonb,
            failed_scopes = $5,
            fingerprint_after = $6,
            documents_expected = $7,
            documents_verified = $8,
            documents_unreadable = $9,
            pages_processed = $10,
            error = $11
      where id = $1 and org_id = $2
      returning id, opportunity_id, scope, state, requested_by, queued_at, started_at,
                finished_at, fingerprint_before, fingerprint_after, documents_expected,
                documents_verified, documents_unreadable, pages_processed, findings,
                failed_scopes, error, accepted_at, accepted_by`,
    [
      input.runId,
      input.orgId,
      state,
      JSON.stringify(input.findings),
      input.failedScopes,
      input.fingerprintAfter,
      input.coverage.documentsExpected,
      input.coverage.documentsVerified,
      input.coverage.documentsUnreadable,
      input.coverage.pagesProcessed,
      input.error ?? null,
    ]
  );
  if (!row) throw new VerificationRejected("That check is not on this account.");
  return toRun(row);
}

/**
 * Cancel a queued check.
 *
 * Only a queued one. A run already in progress has opened documents and may be
 * part way through a comparison; recording it as cancelled would leave a
 * half-finished reading labelled as a decision somebody made.
 */
export async function cancelVerification(runId: string, orgId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `update solicitation_verifications
        set state = 'failed', finished_at = now(), error = 'Cancelled before it started.'
      where id = $1 and org_id = $2 and state = 'queued'
      returning id`,
    [runId, orgId]
  );
  return rows.length > 0;
}

/** Record that a person accepted what a run found. */
export async function acceptFindings(
  runId: string,
  orgId: string,
  actor: string
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `update solicitation_verifications
        set accepted_at = now(), accepted_by = $3
      where id = $1 and org_id = $2 and accepted_at is null
        and state in ('changes_found','conflicts_found','partially_verified')
      returning id`,
    [runId, orgId, actor]
  );
  return rows.length > 0;
}

export async function verificationsFor(
  opportunityId: string,
  orgId: string,
  limit = 20
): Promise<VerificationRun[]> {
  const rows = await query<Row>(
    `${SELECT} where opportunity_id = $1 and org_id = $2 order by queued_at desc limit $3`,
    [opportunityId, orgId, limit]
  );
  return rows.map(toRun);
}

/** The run in flight for this opportunity, when there is one. */
export async function liveVerification(
  opportunityId: string,
  orgId: string
): Promise<VerificationRun | null> {
  const row = await queryOne<Row>(
    `${SELECT} where opportunity_id = $1 and org_id = $2
        and state in ('queued','in_progress')
      order by queued_at desc limit 1`,
    [opportunityId, orgId]
  );
  return row ? toRun(row) : null;
}

/**
 * The last run that finished, whatever it concluded.
 *
 * Not "the last successful one": a screen that shows the last clean result and
 * hides three failures behind it is the screen that says everything is fine.
 */
export async function lastVerification(
  opportunityId: string,
  orgId: string
): Promise<VerificationRun | null> {
  const row = await queryOne<Row>(
    `${SELECT} where opportunity_id = $1 and org_id = $2 and finished_at is not null
      order by finished_at desc limit 1`,
    [opportunityId, orgId]
  );
  return row ? toRun(row) : null;
}

/** When a full check last completed cleanly enough to count, or null. */
export async function lastFullVerificationAt(
  opportunityId: string,
  orgId: string
): Promise<Date | null> {
  const row = await queryOne<{ finished_at: Date }>(
    `select finished_at from solicitation_verifications
      where opportunity_id = $1 and org_id = $2 and scope = 'full'
        and state in ('verified_no_changes','changes_found')
        and finished_at is not null
      order by finished_at desc limit 1`,
    [opportunityId, orgId]
  );
  return row?.finished_at ?? null;
}

/** The snapshot a run took before it checked anything. */
export async function snapshotOf(
  runId: string,
  orgId: string
): Promise<Record<string, unknown> | null> {
  const row = await queryOne<{ snapshot: Record<string, unknown> | null }>(
    `select snapshot from solicitation_verifications where id = $1 and org_id = $2`,
    [runId, orgId]
  );
  return row?.snapshot ?? null;
}
