/**
 * Reading and writing incidents.
 *
 * The lifecycle rules are pure and live in `lib/domain/incident.ts`. This is
 * the part that touches the database, and its whole job is to make sure the
 * pure rules are the only way state changes: every write goes through
 * `advance`, which refuses an illegal transition and records an audit line for
 * a legal one.
 */
import { query, queryOne } from "./db";
import {
  canTransition,
  parseIncidentState,
  type IncidentSeverity,
  type IncidentState,
} from "./domain/incident";

export interface IncidentRow {
  id: string;
  orgId: string;
  state: IncidentState;
  cause: string;
  severity: IncidentSeverity;
  provider: string | null;
  startedAt: Date;
  detectedAt: Date;
  detectionSource: string;
  failedCount: number;
  requeuedCount: number;
  completedCount: number;
  remainingCount: number;
  lastProviderSuccessAt: Date | null;
  lastAgentSuccessAt: Date | null;
  nextRunAt: Date | null;
  recommendedAction: string | null;
  repairAttempts: number;
  recoveryOwner: string | null;
  testRanAt: Date | null;
  testPassed: boolean | null;
  testDetail: string | null;
  recoveredAt: Date | null;
  recoveryNote: string | null;
}

const SELECT = `
  select id, org_id, state, cause, severity, provider, started_at, detected_at,
         detection_source, failed_count, requeued_count, completed_count, remaining_count,
         last_provider_success_at, last_agent_success_at, next_run_at,
         recommended_action, repair_attempts, recovery_owner,
         test_ran_at, test_passed, test_detail, recovered_at, recovery_note
    from automation_incidents`;

function toRow(r: Record<string, unknown>): IncidentRow {
  return {
    id: String(r.id),
    orgId: String(r.org_id),
    state: parseIncidentState(r.state),
    cause: String(r.cause),
    severity: r.severity === "degrading" ? "degrading" : "blocking",
    provider: (r.provider as string) ?? null,
    startedAt: r.started_at as Date,
    detectedAt: r.detected_at as Date,
    detectionSource: String(r.detection_source ?? "job_failure"),
    failedCount: Number(r.failed_count ?? 0),
    requeuedCount: Number(r.requeued_count ?? 0),
    completedCount: Number(r.completed_count ?? 0),
    remainingCount: Number(r.remaining_count ?? 0),
    lastProviderSuccessAt: (r.last_provider_success_at as Date) ?? null,
    lastAgentSuccessAt: (r.last_agent_success_at as Date) ?? null,
    nextRunAt: (r.next_run_at as Date) ?? null,
    recommendedAction: (r.recommended_action as string) ?? null,
    repairAttempts: Number(r.repair_attempts ?? 0),
    recoveryOwner: (r.recovery_owner as string) ?? null,
    testRanAt: (r.test_ran_at as Date) ?? null,
    testPassed: typeof r.test_passed === "boolean" ? r.test_passed : null,
    testDetail: (r.test_detail as string) ?? null,
    recoveredAt: (r.recovered_at as Date) ?? null,
    recoveryNote: (r.recovery_note as string) ?? null,
  };
}

/** Every open incident for one organization, worst first. */
export async function openIncidents(orgId: string): Promise<IncidentRow[]> {
  const rows = await query<Record<string, unknown>>(
    `${SELECT} where org_id = $1 and state <> 'recovered'
      order by (severity = 'blocking') desc, started_at`,
    [orgId]
  );
  return rows.map(toRow);
}

export async function incidentById(id: string, orgId: string): Promise<IncidentRow | null> {
  // Scoped in the query rather than checked afterwards: an id is something a
  // person can put in a URL.
  const row = await queryOne<Record<string, unknown>>(`${SELECT} where id = $1 and org_id = $2`, [
    id,
    orgId,
  ]);
  return row ? toRow(row) : null;
}

export interface OpenIncidentInput {
  orgId: string;
  cause: string;
  severity: IncidentSeverity;
  provider?: string | null;
  startedAt: Date;
  detectionSource?: string;
  failedCount: number;
  recommendedAction?: string | null;
  lastAgentSuccessAt?: Date | null;
  nextRunAt?: Date | null;
}

/**
 * Open an incident for this cause, or update the one already open.
 *
 * Upsert rather than insert, on the partial unique index. Every assessment
 * that ran while the provider was down would otherwise open another incident
 * for the same outage, and the recovery button would have to guess which one
 * it was recovering.
 *
 * `started_at` deliberately keeps the EARLIEST value: an outage that began at
 * nine and is still going at three did not start at three, and the elapsed
 * time is the number an operator uses to decide how worried to be.
 */
export async function openOrUpdateIncident(input: OpenIncidentInput): Promise<IncidentRow> {
  const row = await queryOne<Record<string, unknown>>(
    `insert into automation_incidents
       (org_id, cause, severity, provider, started_at, detected_at, detection_source,
        failed_count, recommended_action, last_agent_success_at, next_run_at, remaining_count)
     values ($1,$2,$3,$4,$5,now(),$6,$7,$8,$9,$10,$7)
     on conflict (org_id, cause) where state <> 'recovered'
     do update set
       failed_count = excluded.failed_count,
       remaining_count = greatest(0, excluded.failed_count - automation_incidents.completed_count),
       severity = excluded.severity,
       started_at = least(automation_incidents.started_at, excluded.started_at),
       last_agent_success_at = excluded.last_agent_success_at,
       next_run_at = excluded.next_run_at,
       recommended_action = excluded.recommended_action,
       updated_at = now()
     returning id, org_id, state, cause, severity, provider, started_at, detected_at,
               detection_source, failed_count, requeued_count, completed_count, remaining_count,
               last_provider_success_at, last_agent_success_at, next_run_at,
               recommended_action, repair_attempts, recovery_owner,
               test_ran_at, test_passed, test_detail, recovered_at, recovery_note`,
    [
      input.orgId,
      input.cause,
      input.severity,
      input.provider ?? null,
      input.startedAt,
      input.detectionSource ?? "job_failure",
      input.failedCount,
      input.recommendedAction ?? null,
      input.lastAgentSuccessAt ?? null,
      input.nextRunAt ?? null,
    ]
  );
  return toRow(row!);
}

export class IllegalTransition extends Error {
  constructor(
    readonly from: IncidentState,
    readonly to: IncidentState
  ) {
    super(`An incident cannot go from ${from} to ${to}.`);
    this.name = "IllegalTransition";
  }
}

export interface AdvanceInput {
  incidentId: string;
  orgId: string;
  to: IncidentState;
  actor: string;
  detail?: string;
  /** Extra columns to set in the same write, so state and evidence agree. */
  set?: {
    testRanAt?: Date;
    testPassed?: boolean;
    testDetail?: string;
    requeuedCount?: number;
    completedCount?: number;
    remainingCount?: number;
    recoveryOwner?: string;
    recoveryNote?: string;
    lastProviderSuccessAt?: Date;
  };
}

/**
 * Move an incident, or refuse.
 *
 * The transition check and the audit line are in the same statement sequence
 * as the write on purpose. A state change with no audit line is a change
 * nobody can follow up, and an audit line for a change that did not happen is
 * worse than none.
 *
 * `recovered` sets `recovered_at` here rather than leaving it to the caller,
 * because a check constraint refuses the row without it and a caller who
 * forgets would get a constraint violation instead of a recovery.
 */
export async function advance(input: AdvanceInput): Promise<IncidentRow> {
  const current = await incidentById(input.incidentId, input.orgId);
  if (!current) throw new Error("No such incident for this organization.");
  if (current.state === input.to) return current;
  if (!canTransition(current.state, input.to)) {
    throw new IllegalTransition(current.state, input.to);
  }

  const set = input.set ?? {};
  await query(
    `update automation_incidents set
       state = $3,
       test_ran_at = coalesce($4, test_ran_at),
       test_passed = coalesce($5, test_passed),
       test_detail = coalesce($6, test_detail),
       requeued_count = coalesce($7, requeued_count),
       completed_count = coalesce($8, completed_count),
       remaining_count = coalesce($9, remaining_count),
       recovery_owner = coalesce($10, recovery_owner),
       recovery_note = coalesce($11, recovery_note),
       last_provider_success_at = coalesce($12, last_provider_success_at),
       recovered_at = case when $3 = 'recovered' then now() else recovered_at end,
       repair_attempts = case when $3 = 'test_passed' or $3 = 'recovery_failed'
                              then repair_attempts + 1 else repair_attempts end,
       updated_at = now()
     where id = $1 and org_id = $2`,
    [
      input.incidentId,
      input.orgId,
      input.to,
      set.testRanAt ?? null,
      set.testPassed ?? null,
      set.testDetail ?? null,
      set.requeuedCount ?? null,
      set.completedCount ?? null,
      set.remainingCount ?? null,
      set.recoveryOwner ?? null,
      set.recoveryNote ?? null,
      set.lastProviderSuccessAt ?? null,
    ]
  );
  await query(
    `insert into incident_events (incident_id, org_id, from_state, to_state, actor, detail)
     values ($1,$2,$3,$4,$5,$6)`,
    [input.incidentId, input.orgId, current.state, input.to, input.actor, input.detail ?? null]
  );
  const updated = await incidentById(input.incidentId, input.orgId);
  return updated!;
}

export interface IncidentEvent {
  fromState: IncidentState | null;
  toState: IncidentState;
  actor: string;
  detail: string | null;
  at: Date;
}

/** How this incident got where it is, oldest first. */
export async function incidentHistory(
  incidentId: string,
  orgId: string
): Promise<IncidentEvent[]> {
  const rows = await query<Record<string, unknown>>(
    `select from_state, to_state, actor, detail, created_at
       from incident_events where incident_id = $1 and org_id = $2
      order by created_at`,
    [incidentId, orgId]
  );
  return rows.map((r) => ({
    fromState: r.from_state ? parseIncidentState(r.from_state) : null,
    toState: parseIncidentState(r.to_state),
    actor: String(r.actor),
    detail: (r.detail as string) ?? null,
    at: r.created_at as Date,
  }));
}

/**
 * Record what the assessment just found.
 *
 * `assessAutomation` derives incidents from a rolling window and is right to;
 * this is what gives those findings a life beyond the window. Every blocking
 * cause it reports opens or updates one persisted incident, and any incident
 * whose backlog has finished draining is closed.
 *
 * Deliberately not called from `automationHealth()`, which runs on every page
 * render through the nav badge. A write on every page load is a write nobody
 * asked for, and one that would contend on the partial unique index under any
 * real traffic. It is called where an incident matters: the Automation Health
 * page and the recovery endpoints.
 *
 * Only blocking causes open incidents. A degraded run that resolved itself is
 * not something to keep a record of and chase to a formal recovery, and
 * treating it as one trains people to ignore incidents, which is the failure
 * mode this whole model exists to avoid.
 */
export async function syncAutomationIncidents(
  orgId: string,
  health: {
    incidents: {
      cause: string;
      spec: { blocking: boolean; repair?: string };
      failures: number;
      firstSeen: string;
    }[];
    lastSuccessAt: string | null;
  },
  nextRunAt?: Date | null
): Promise<IncidentRow[]> {
  for (const found of health.incidents) {
    if (!found.spec.blocking) continue;
    await openOrUpdateIncident({
      orgId,
      cause: found.cause,
      severity: "blocking",
      provider: found.cause.startsWith("provider_") ? "anthropic" : null,
      startedAt: new Date(found.firstSeen),
      failedCount: found.failures,
      recommendedAction: found.spec.repair ?? null,
      lastAgentSuccessAt: health.lastSuccessAt ? new Date(health.lastSuccessAt) : null,
      nextRunAt: nextRunAt ?? null,
    }).catch((err) => {
      // A bookkeeping write must never take down the page that reports the
      // outage. The health assessment above it is still true.
      console.error(`[incidents] could not record ${found.cause}: ${(err as Error).message}`);
    });
  }

  const open = await openIncidents(orgId);
  const { reconcileDraining } = await import("./recovery");
  const reconciled = await Promise.all(
    open.map((i) => reconcileDraining(i).catch(() => i))
  );
  return reconciled.filter((i) => i.state !== "recovered");
}
